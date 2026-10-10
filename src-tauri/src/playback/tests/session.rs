use super::super::persistence::SessionPersistence;
use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Default)]
struct FakeAudio {
    track: Option<NowPlayingTrack>,
    playing: bool,
    ended: bool,
    position: u64,
    next_id: u64,
    starts: Vec<i64>,
    stops: Vec<u64>,
    preparations: Vec<(u64, Option<String>)>,
    skipped: HashSet<i64>,
    failed: HashSet<i64>,
    stop_result: Option<Result<bool, String>>,
    seek_failure: bool,
    status_failure: bool,
    invalidate_on_start: Option<Arc<AtomicU64>>,
    invalidate_on_stop: Option<Arc<AtomicU64>>,
    skip_on_start: Option<i64>,
    volume: u8,
    volume_failure: bool,
}

impl SessionAudio for FakeAudio {
    fn start(&mut self, id: i64, key: &str) -> Result<NowPlayingTrack, String> {
        self.starts.push(id);
        if self.failed.contains(&id) {
            return Err("AUDIO_FILE_NOT_FOUND: missing file".into());
        }
        self.next_id += 1;
        let track = NowPlayingTrack {
            track_id: id,
            playback_id: self.next_id,
            title: Some(format!("Track {id}")),
            artist: Some("Artist".into()),
            row_key: Some(key.into()),
            previous_playback_id: None,
        };
        self.track = Some(track.clone());
        self.ended = false;
        self.playing = true;
        if let Some(generation) = self.invalidate_on_start.take() {
            generation.fetch_add(1, Ordering::SeqCst);
        }
        if self.skip_on_start == Some(id) {
            self.skipped.insert(id);
        }
        Ok(track)
    }
    fn status(&self) -> Result<PlaybackStatus, String> {
        if self.status_failure {
            return Err("status unavailable".into());
        }
        Ok(PlaybackStatus {
            has_audio: self.track.is_some(),
            is_playing: self.playing && !self.ended,
            has_ended: self.ended,
            playback_id: self.track.as_ref().map(|track| track.playback_id),
            position_ms: self.position,
            duration_ms: if self.track.is_some() { 100 } else { 0 },
            now_playing: self.track.clone(),
        })
    }
    fn prepare(
        &mut self,
        id: u64,
        _revision: u64,
        track: Option<&QueueTrack>,
    ) -> Result<bool, String> {
        self.preparations
            .push((id, track.map(|track| track.row_key.clone())));
        if track.is_some_and(|track| self.failed.contains(&track.track_id)) {
            return Err("AUDIO_FILE_NOT_FOUND: missing file".into());
        }
        Ok(self
            .track
            .as_ref()
            .is_some_and(|track| track.playback_id == id))
    }
    fn stop(&mut self, id: u64) -> Result<bool, String> {
        self.stops.push(id);
        if let Some(generation) = self.invalidate_on_stop.take() {
            generation.fetch_add(1, Ordering::SeqCst);
        }
        if let Some(result) = self.stop_result.clone() {
            return result;
        }
        if !self
            .track
            .as_ref()
            .is_some_and(|track| track.playback_id == id)
        {
            return Ok(false);
        }
        self.track = None;
        self.playing = false;
        self.ended = false;
        Ok(true)
    }
    fn pause(&mut self) -> Result<(), String> {
        self.playing = false;
        Ok(())
    }
    fn resume(&mut self) -> Result<(), String> {
        self.playing = true;
        Ok(())
    }
    fn seek(&mut self, position: u64) -> Result<(), String> {
        if self.seek_failure {
            return Err("seek failed".into());
        }
        self.position = position;
        self.ended = position >= 100;
        Ok(())
    }
    fn set_volume(&mut self, volume: u8) -> Result<(), String> {
        if self.volume_failure {
            return Err("Volume unavailable".into());
        }
        self.volume = volume;
        Ok(())
    }
    fn skipped(&self) -> HashSet<i64> {
        self.skipped.clone()
    }
}

fn rows(ids: &[i64]) -> Vec<QueueTrack> {
    ids.iter()
        .enumerate()
        .map(|(index, id)| QueueTrack {
            track_id: *id,
            row_key: format!("row:{index}"),
            title: Some(format!("Track {id}")),
            album: None,
            duration_ms: Some(100),
        })
        .collect()
}
fn fixture() -> Session<FakeAudio> {
    Session::new(
        FakeAudio::default(),
        SavedSession::default(),
        Arc::new(AtomicU64::new(0)),
    )
}
fn execute(
    session: &mut Session<FakeAudio>,
    command: SessionCommand,
) -> (bool, Option<RemovalResult>, Option<u64>) {
    let generation = if command.invalidates() {
        session.generation.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        session.generation.load(Ordering::SeqCst)
    };
    session.execute(command, generation).unwrap()
}
fn play(session: &mut Session<FakeAudio>, ids: &[i64], index: usize) -> bool {
    execute(
        session,
        SessionCommand::PlayTracks {
            tracks: rows(ids),
            start_row_key: format!("row:{index}"),
            allow_skipped: true,
        },
    )
    .0
}
fn current(session: &Session<FakeAudio>) -> Option<i64> {
    session.current_track.as_ref().map(|track| track.track_id)
}
fn ids(session: &Session<FakeAudio>) -> Vec<i64> {
    session
        .queue
        .displayed_tracks
        .iter()
        .map(|track| track.track_id)
        .collect()
}
fn boundary(session: &mut Session<FakeAudio>, key: &str) {
    let item = session.queue.find(key).unwrap();
    session.audio.next_id += 1;
    session.audio.track = Some(NowPlayingTrack {
        track_id: item.track_id,
        playback_id: session.audio.next_id,
        row_key: Some(key.into()),
        previous_playback_id: session.playback_id,
        title: item.title.clone(),
        artist: None,
    });
    session.audio.ended = false;
    session.audio.playing = true;
}

#[path = "session_lifecycle.rs"]
mod lifecycle;
#[path = "session_persistence.rs"]
mod persistence;
#[path = "session_queue.rs"]
mod queue;

impl SessionAudio for Arc<Mutex<FakeAudio>> {
    fn start(&mut self, id: i64, key: &str) -> Result<NowPlayingTrack, String> {
        self.lock().unwrap().start(id, key)
    }
    fn status(&self) -> Result<PlaybackStatus, String> {
        self.lock().unwrap().status()
    }
    fn prepare(
        &mut self,
        id: u64,
        revision: u64,
        track: Option<&QueueTrack>,
    ) -> Result<bool, String> {
        self.lock().unwrap().prepare(id, revision, track)
    }
    fn stop(&mut self, id: u64) -> Result<bool, String> {
        self.lock().unwrap().stop(id)
    }
    fn pause(&mut self) -> Result<(), String> {
        self.lock().unwrap().pause()
    }
    fn resume(&mut self) -> Result<(), String> {
        self.lock().unwrap().resume()
    }
    fn seek(&mut self, position: u64) -> Result<(), String> {
        self.lock().unwrap().seek(position)
    }
    fn set_volume(&mut self, volume: u8) -> Result<(), String> {
        self.lock().unwrap().set_volume(volume)
    }
    fn skipped(&self) -> HashSet<i64> {
        self.lock().unwrap().skipped()
    }
}

pub(crate) fn initialize_test_session<R: tauri::Runtime>(app: &AppHandle<R>, path: PathBuf) {
    let (requests, receiver) = mpsc::channel();
    let generation = Arc::new(AtomicU64::new(0));
    let busy = Arc::new(AtomicBool::new(false));
    app.manage(PlaybackSession {
        requests,
        busy: busy.clone(),
        generation: generation.clone(),
    });
    std::thread::spawn(move || {
        run_worker(
            FakeAudio::default(),
            path,
            generation,
            busy,
            receiver,
            |_| {},
        )
    });
}

#[path = "session_volume.rs"]
mod volume;
#[path = "session_worker.rs"]
mod worker;
