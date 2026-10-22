use crate::metadata::files::replaygain;
use rodio::{source::SeekError, ChannelCount, SampleRate, Source};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

fn amplitude(gain: replaygain::TrackGain, preamp_db: f64) -> f32 {
    let Some(gain_db) = gain.gain_db else {
        return 1.0;
    };
    let requested = 10.0_f64.powf((gain_db + preamp_db) / 20.0);
    let ceiling = gain
        .peak
        .filter(|peak| *peak > 0.0)
        .map(|peak| 1.0 / peak)
        .unwrap_or(1.0);
    requested.min(ceiling) as f32
}

pub(super) struct GainSource<S> {
    source: S,
    gain: replaygain::TrackGain,
    amplitude: f32,
    applied_preamp: u64,
    preamp: Arc<AtomicU64>,
    enabled: Arc<AtomicBool>,
}

impl<S> GainSource<S> {
    pub(super) fn new(
        source: S,
        path: &Path,
        enabled: Arc<AtomicBool>,
        preamp: Arc<AtomicU64>,
    ) -> Self {
        let gain = match replaygain::read(path) {
            Ok(gain) => gain,
            Err(error) => {
                log::debug!(
                    "ReplayGain tags unavailable for '{}': {error}",
                    path.display()
                );
                replaygain::TrackGain::default()
            }
        };
        let applied_preamp = preamp.load(Ordering::Relaxed);
        Self {
            source,
            gain,
            amplitude: amplitude(gain, f64::from_bits(applied_preamp)),
            applied_preamp,
            preamp,
            enabled,
        }
    }
}

impl<S: Source<Item = f32>> Iterator for GainSource<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        self.source.next().map(|sample| {
            if self.enabled.load(Ordering::Relaxed) {
                let preamp = self.preamp.load(Ordering::Relaxed);
                if preamp != self.applied_preamp {
                    self.amplitude = amplitude(self.gain, f64::from_bits(preamp));
                    self.applied_preamp = preamp;
                }
                sample * self.amplitude
            } else {
                sample
            }
        })
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.source.size_hint()
    }
}

impl<S: Source<Item = f32>> Source for GainSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.source.current_span_len()
    }
    fn channels(&self) -> ChannelCount {
        self.source.channels()
    }
    fn sample_rate(&self) -> SampleRate {
        self.source.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.source.total_duration()
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.source.try_seek(pos)
    }
}
