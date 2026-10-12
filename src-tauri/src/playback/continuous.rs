use rodio::{ChannelCount, SampleRate, Source};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::time::Duration;

use super::statistics::qualification::Playthrough;
use super::NowPlayingTrack;

pub struct PreparedTrack {
    pub track: NowPlayingTrack,
    pub duration: Duration,
    pub source: Box<dyn Source<Item = f32> + Send>,
}

#[derive(Clone)]
pub struct TrackSnapshot {
    pub track: NowPlayingTrack,
    pub duration: Duration,
    pub position: Duration,
    pub ended: bool,
}

struct Control {
    snapshot: TrackSnapshot,
    revision: u64,
    next: Option<PreparedTrack>,
    sample_rate: SampleRate,
    channels: ChannelCount,
}

#[derive(Clone)]
pub struct ContinuousPlayback {
    control: Arc<Mutex<Control>>,
    samples: Arc<AtomicU64>,
}

impl ContinuousPlayback {
    pub fn snapshot(&self) -> TrackSnapshot {
        let control = self.control.lock().unwrap();
        let mut snapshot = control.snapshot.clone();
        if !snapshot.ended {
            snapshot.position = Duration::from_secs_f64(
                self.samples.load(Ordering::Relaxed) as f64
                    / f64::from(control.channels.get())
                    / f64::from(control.sample_rate.get()),
            );
            if !snapshot.duration.is_zero() {
                snapshot.position = snapshot.position.min(snapshot.duration);
            }
        }
        snapshot
    }

    // Reserving first invalidates any old decoder before loading a replacement.
    pub fn reserve(&self, playback_id: u64, revision: u64) -> bool {
        let mut control = self.control.lock().unwrap();
        if control.snapshot.track.playback_id != playback_id || revision <= control.revision {
            return false;
        }
        control.revision = revision;
        control.next = None;
        true
    }

    pub fn prepare(&self, playback_id: u64, revision: u64, next: PreparedTrack) -> bool {
        let mut control = self.control.lock().unwrap();
        if control.snapshot.track.playback_id != playback_id || revision != control.revision {
            return false;
        }
        control.next = Some(next);
        true
    }
}

pub struct ContinuousSource {
    current: PreparedTrack,
    playback: ContinuousPlayback,
    transitions: mpsc::Sender<NowPlayingTrack>,
    exhausted: bool,
    position_samples: u64,
    skipped_tracks: Arc<RwLock<HashSet<i64>>>,
    statistics: mpsc::Sender<i64>,
    playthrough: Playthrough,
}

impl ContinuousSource {
    pub fn new(
        current: PreparedTrack,
        skipped_tracks: Arc<RwLock<HashSet<i64>>>,
        statistics: mpsc::Sender<i64>,
    ) -> (Self, ContinuousPlayback, mpsc::Receiver<NowPlayingTrack>) {
        let (transitions, receiver) = mpsc::channel();
        let playthrough = Playthrough::new(
            current.duration,
            u64::from(current.source.sample_rate().get())
                * u64::from(current.source.channels().get()),
        );
        let playback = ContinuousPlayback {
            control: Arc::new(Mutex::new(Control {
                snapshot: TrackSnapshot {
                    track: current.track.clone(),
                    duration: current.duration,
                    position: Duration::ZERO,
                    ended: false,
                },
                revision: 0,
                next: None,
                sample_rate: current.source.sample_rate(),
                channels: current.source.channels(),
            })),
            samples: Arc::new(AtomicU64::new(0)),
        };
        (
            Self {
                current,
                playback: playback.clone(),
                transitions,
                exhausted: false,
                position_samples: 0,
                skipped_tracks,
                statistics,
                playthrough,
            },
            playback,
            receiver,
        )
    }
}

impl Iterator for ContinuousSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        loop {
            if !self.exhausted {
                if let Some(sample) = self.current.source.next() {
                    self.position_samples += 1;
                    if self.playthrough.observe(self.position_samples, false) {
                        if let Some(id) = self.current.track.track_id {
                            if let Err(error) = self.statistics.send(id) {
                                log::error!("Playback statistics recorder is unavailable: {error}");
                            }
                        }
                    }
                    self.playback
                        .samples
                        .store(self.position_samples, Ordering::Relaxed);
                    return Some(sample);
                }
                self.exhausted = true;
                if self.playthrough.observe(self.position_samples, true) {
                    if let Some(id) = self.current.track.track_id {
                        if let Err(error) = self.statistics.send(id) {
                            log::error!("Playback statistics recorder is unavailable: {error}");
                        }
                    }
                }
            }

            let mut control = self.playback.control.lock().unwrap();
            // Only automatic transitions consult the flag; the initial track
            // may have been explicitly requested. Hold through the transition
            // so preference changes and audio boundaries have a defined order.
            let skipped_tracks = self.skipped_tracks.read().unwrap();
            let next = control.next.take().filter(|next| {
                !next
                    .track
                    .track_id
                    .is_some_and(|id| skipped_tracks.contains(&id))
            });
            let Some(mut next) = next else {
                control.snapshot.ended = true;
                control.snapshot.position = control.snapshot.duration;
                // Keep the Player alive so pause/resume and seeking still work.
                return Some(0.0);
            };
            next.track.previous_playback_id = Some(self.current.track.playback_id);
            control.snapshot = TrackSnapshot {
                track: next.track.clone(),
                duration: next.duration,
                position: Duration::ZERO,
                ended: false,
            };
            control.sample_rate = next.source.sample_rate();
            control.channels = next.source.channels();
            self.position_samples = 0;
            self.playback.samples.store(0, Ordering::Relaxed);
            drop(control);
            drop(skipped_tracks);
            let _ = self.transitions.send(next.track.clone());
            self.playthrough = Playthrough::new(
                next.duration,
                u64::from(next.source.sample_rate().get())
                    * u64::from(next.source.channels().get()),
            );
            self.current = next;
            self.exhausted = false;
            // Consume the next track in this same call, with no silence between tracks.
        }
    }
}

impl Source for ContinuousSource {
    fn current_span_len(&self) -> Option<usize> {
        if self.exhausted {
            Some(self.channels().get() as usize)
        } else {
            self.current.source.current_span_len()
        }
    }

    fn channels(&self) -> ChannelCount {
        self.current.source.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.current.source.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }

    fn try_seek(&mut self, position: Duration) -> Result<(), rodio::source::SeekError> {
        let samples = (position.as_secs_f64()
            * f64::from(self.sample_rate().get())
            * f64::from(self.channels().get())) as u64;
        self.current.source.try_seek(position)?;
        if samples != self.position_samples {
            self.playthrough.seek();
        }
        self.exhausted = false;
        let mut control = self.playback.control.lock().unwrap();
        control.snapshot.ended = false;
        self.position_samples = samples;
        self.playback
            .samples
            .store(self.position_samples, Ordering::Relaxed);
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/continuous/statistics.rs"]
mod statistics_tests;
#[cfg(test)]
#[path = "tests/continuous.rs"]
mod tests;
