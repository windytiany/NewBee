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
    library_paths: std::collections::HashMap<i64, String>,
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
    database: Option<crate::database::Database>,
    metadata_reads: std::sync::atomic::AtomicUsize,
    metadata_failure: bool,
    registrations: usize,
    start_rows: Vec<String>,
    row_failures: std::collections::HashMap<String, String>,
    decoder_attempts: Vec<i64>,
    scheduled: Vec<i64>,
}

impl SessionAudio for FakeAudio {
    fn register(&mut self, tracks: &mut Vec<QueueTrack>) -> Result<Vec<String>, String> {
        if !tracks.iter().any(|track| track.path.is_some()) {
            return Ok(Vec::new());
        }
        self.registrations += 1;
        if let Some(database) = &self.database {
            let registration = super::identity::register(database, tracks)?;
            self.scheduled.extend(registration.pending);
            for track in tracks {
                let id = track.track_id.unwrap();
                self.library_paths
                    .insert(id, database.get_track_for_playback(id)?.unwrap().path);
            }
            return Ok(registration.failures);
        }
        for track in tracks {
            if !track.valid_target() {
                return Err("Invalid playback target".into());
            }
            if let Some(path) = track.path.take() {
                let id = self
                    .library_paths
                    .iter()
                    .find_map(|(id, known)| (known == &path).then_some(*id))
                    .unwrap_or(self.library_paths.len() as i64 + 1000);
                self.library_paths.insert(id, path);
                track.track_id = Some(id);
            }
        }
        Ok(Vec::new())
    }
    fn metadata(&self, ids: &[i64]) -> Result<Vec<MetadataUpdate>, String> {
        self.metadata_reads.fetch_add(1, Ordering::SeqCst);
        if self.metadata_failure {
            return Err("metadata unavailable".into());
        }
        self.database
            .as_ref()
            .map_or(Ok(Vec::new()), |db| super::metadata::read(db, ids))
    }
    fn paths(&self, ids: &[i64]) -> Result<Vec<String>, String> {
        Ok(ids
            .iter()
            .map(|id| {
                self.library_paths
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| format!("/track/{id}.wav"))
            })
            .collect())
    }
    fn start(&mut self, item: &QueueTrack) -> Result<NowPlayingTrack, String> {
        let id = item.track_id.unwrap_or(0);
        let key = &item.row_key;
        self.starts.push(id);
        self.start_rows.push(key.clone());
        if let Some(error) = self.row_failures.get(key) {
            return Err(error.clone());
        }
        if let Some(database) = &self.database {
            let info = crate::playback::target_info(item, database)?;
            self.decoder_attempts.push(id);
            crate::playback::open_decoder(std::path::Path::new(&info.path))
                .map_err(crate::playback::PlaybackError::into_play_command_message)?;
        }
        if self.failed.contains(&id) {
            return Err("AUDIO_FILE_NOT_FOUND: missing file".into());
        }
        self.next_id += 1;
        let track = NowPlayingTrack {
            track_id: item.track_id,
            path: item
                .path
                .clone()
                .or_else(|| self.library_paths.get(&id).cloned())
                .or_else(|| Some(format!("/track/{id}.wav"))),
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
        if let Some(error) = track.and_then(|track| self.row_failures.get(&track.row_key)) {
            return Err(error.clone());
        }
        if track.is_some_and(|track| track.track_id.is_some_and(|id| self.failed.contains(&id))) {
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
        let mut skipped = self.skipped.clone();
        if let Some(database) = &self.database {
            skipped.extend(database.list_skipped_track_ids().unwrap());
        }
        skipped
    }
}

fn rows(ids: &[i64]) -> Vec<QueueTrack> {
    ids.iter()
        .enumerate()
        .map(|(index, id)| QueueTrack {
            track_id: Some(*id),
            path: None,
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
    session
        .current_track
        .as_ref()
        .and_then(|track| track.track_id)
}
fn ids(session: &Session<FakeAudio>) -> Vec<i64> {
    session
        .queue
        .displayed_tracks
        .iter()
        .filter_map(|track| track.track_id)
        .collect()
}
fn boundary(session: &mut Session<FakeAudio>, key: &str) {
    let item = session.queue.find(key).unwrap();
    session.audio.next_id += 1;
    session.audio.track = Some(NowPlayingTrack {
        track_id: item.track_id,
        path: item.path.clone(),
        playback_id: session.audio.next_id,
        row_key: Some(key.into()),
        previous_playback_id: session.playback_id,
        title: item.title.clone(),
        artist: None,
    });
    session.audio.ended = false;
    session.audio.playing = true;
}

#[path = "session/failures.rs"]
mod failures;
#[path = "session/identity.rs"]
mod identity;
#[path = "session/lifecycle.rs"]
mod lifecycle;
#[path = "session/persistence.rs"]
mod persistence;
#[path = "session/queue.rs"]
mod queue;

impl SessionAudio for Arc<Mutex<FakeAudio>> {
    fn register(&mut self, tracks: &mut Vec<QueueTrack>) -> Result<Vec<String>, String> {
        self.lock().unwrap().register(tracks)
    }
    fn metadata(&self, ids: &[i64]) -> Result<Vec<MetadataUpdate>, String> {
        self.lock().unwrap().metadata(ids)
    }
    fn paths(&self, ids: &[i64]) -> Result<Vec<String>, String> {
        self.lock().unwrap().paths(ids)
    }
    fn start(&mut self, item: &QueueTrack) -> Result<NowPlayingTrack, String> {
        self.lock().unwrap().start(item)
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
            |_| {},
        )
    });
}

#[path = "session/performance.rs"]
mod performance;
#[path = "session/volume.rs"]
mod volume;
#[path = "session/worker.rs"]
mod worker;

#[path = "session/metadata.rs"]
mod metadata;
