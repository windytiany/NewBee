use super::super::persistence::SessionPersistence;
use super::*;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const SESSION_TICK_INTERVAL: Duration = Duration::from_millis(50);

pub(super) enum Request {
    Command {
        command: SessionCommand,
        generation: u64,
        reply: mpsc::Sender<Result<SessionReply, String>>,
    },
    Metadata {
        tracks: Vec<MetadataUpdate>,
        reply: mpsc::Sender<Result<Option<MetadataDelta>, String>>,
    },
    Progress {
        reply: mpsc::Sender<Result<SessionProgress, String>>,
    },
    Backup {
        reply: mpsc::Sender<SavedSession>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProgress {
    pub(super) revision: u64,
    pub(super) structural_revision: u64,
    pub(super) playback_status: PlaybackStatus,
}

pub struct PlaybackSession {
    pub(super) requests: mpsc::Sender<Request>,
    pub(super) busy: Arc<AtomicBool>,
    pub(super) generation: Arc<AtomicU64>,
}

impl PlaybackSession {
    pub(super) fn request(
        &self,
        command: SessionCommand,
    ) -> Result<mpsc::Receiver<Result<SessionReply, String>>, String> {
        let generation = if command.invalidates() {
            self.generation.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            self.generation.load(Ordering::SeqCst)
        };
        let (reply, receiver) = mpsc::channel();
        self.requests
            .send(Request::Command {
                command,
                generation,
                reply,
            })
            .map_err(|_| "Playback session is unavailable".to_owned())?;
        Ok(receiver)
    }

    pub(super) fn metadata(
        &self,
        tracks: Vec<MetadataUpdate>,
    ) -> Result<mpsc::Receiver<Result<Option<MetadataDelta>, String>>, String> {
        let (reply, receiver) = mpsc::channel();
        self.requests
            .send(Request::Metadata { tracks, reply })
            .map_err(|_| "Playback session is unavailable".to_owned())?;
        Ok(receiver)
    }

    pub(super) fn progress(
        &self,
    ) -> Result<mpsc::Receiver<Result<SessionProgress, String>>, String> {
        let (reply, receiver) = mpsc::channel();
        self.requests
            .send(Request::Progress { reply })
            .map_err(|_| "Playback session is unavailable".to_owned())?;
        Ok(receiver)
    }
}

pub(crate) fn backup_snapshot(app: &AppHandle) -> Result<SavedSession, String> {
    let (reply, receiver) = mpsc::channel();
    app.state::<PlaybackSession>()
        .requests
        .send(Request::Backup { reply })
        .map_err(|_| "Playback session is unavailable".to_owned())?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|error| format!("Could not back up playback session: {error}"))
}

pub fn initialize(app: &AppHandle, path: PathBuf) {
    let (requests, receiver) = mpsc::channel();
    let generation = Arc::new(AtomicU64::new(0));
    let busy = Arc::new(AtomicBool::new(false));
    app.manage(PlaybackSession {
        requests,
        busy: busy.clone(),
        generation: generation.clone(),
    });
    let app = app.clone();
    std::thread::spawn(move || {
        run_worker(
            super::audio::DesktopAudio(app.clone()),
            path,
            generation,
            busy,
            receiver,
            |snapshot| {
                if let Err(error) = app.emit("playback-session-changed", snapshot) {
                    log::warn!("Could not publish playback session: {error}");
                }
            },
            |delta| {
                if let Err(error) = app.emit("playback-session-metadata", delta) {
                    log::warn!("Could not publish playback metadata: {error}");
                }
            },
        )
    });
}

fn publish_change<A: SessionAudio>(
    session: &mut Session<A>,
    persistence: &mut SessionPersistence,
    publish: &mut impl FnMut(&SessionSnapshot),
) {
    session.revision += 1;
    session.structural_revision = session.revision;
    if let Err(error) = persistence.save(&session.saved()) {
        log::warn!("{error}");
        session.playback_error = error;
    }
    match session.snapshot() {
        Ok(snapshot) => publish(&snapshot),
        Err(error) => log::warn!("Could not read playback session: {error}"),
    }
}

fn set_pending<A: SessionAudio>(
    session: &mut Session<A>,
    busy: &AtomicBool,
    publish: &mut impl FnMut(&SessionSnapshot),
) {
    busy.store(true, Ordering::SeqCst);
    session.command_pending = true;
    session.revision += 1;
    session.structural_revision = session.revision;
    if let Ok(snapshot) = session.snapshot() {
        publish(&snapshot);
    }
}

pub(super) fn run_worker<A: SessionAudio>(
    audio: A,
    path: PathBuf,
    generation: Arc<AtomicU64>,
    busy: Arc<AtomicBool>,
    receiver: mpsc::Receiver<Request>,
    mut publish: impl FnMut(&SessionSnapshot),
    mut publish_metadata: impl FnMut(&MetadataDelta),
) {
    let (mut persistence, saved) = SessionPersistence::load(path);
    let mut session = Session::new(audio, saved, generation);
    let mut next_tick = Instant::now() + SESSION_TICK_INTERVAL;
    let mut diagnostics = crate::logging::RepeatedFailure::default();
    loop {
        // Check the deadline even if IPC is continuously queued. Progress readers
        // cannot starve autonomous advancement or next-track preparation.
        if Instant::now() >= next_tick {
            let pending = session.audio.status().is_ok_and(|status| {
                status.has_ended
                    && status.playback_id == session.playback_id
                    && session.handled_end != session.playback_id
            }) && session.editing.is_none()
                && !session.seeking;
            if pending {
                set_pending(&mut session, &busy, &mut publish);
            }
            let result = session.tick();
            session.command_pending = false;
            busy.store(false, Ordering::SeqCst);
            diagnostics.report(
                "playback.session",
                result.as_ref().err().map(String::as_str),
            );
            match result {
                Ok(changed) if changed || pending => {
                    publish_change(&mut session, &mut persistence, &mut publish)
                }
                Err(error) => {
                    session.playback_error = error;
                    if pending {
                        publish_change(&mut session, &mut persistence, &mut publish);
                    }
                }
                _ => {}
            }
            next_tick = Instant::now() + SESSION_TICK_INTERVAL;
        }
        let request =
            match receiver.recv_timeout(next_tick.saturating_duration_since(Instant::now())) {
                Ok(request) => request,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
        let changed = match session.reconcile() {
            Ok(changed) => changed | session.refresh_skipped(),
            Err(error) => {
                session.playback_error = error;
                false
            }
        };
        match request {
            Request::Metadata { tracks, reply } => {
                if changed {
                    publish_change(&mut session, &mut persistence, &mut publish);
                }
                let result = session.refresh_metadata(tracks);
                if let Ok(Some(delta)) = &result {
                    publish_metadata(delta);
                }
                let _ = reply.send(result);
            }
            Request::Backup { reply } => {
                if changed {
                    publish_change(&mut session, &mut persistence, &mut publish);
                }
                let _ = reply.send(session.saved());
            }
            Request::Progress { reply } => {
                if changed {
                    publish_change(&mut session, &mut persistence, &mut publish);
                }
                let progress = session
                    .audio
                    .status()
                    .map(|playback_status| SessionProgress {
                        revision: session.revision,
                        structural_revision: session.structural_revision,
                        playback_status,
                    });
                let _ = reply.send(progress);
            }
            Request::Command {
                command,
                generation,
                reply,
            } => {
                let mutation = !matches!(command, SessionCommand::Snapshot);
                if mutation {
                    set_pending(&mut session, &busy, &mut publish);
                }
                let result = if mutation {
                    session.execute(command, generation)
                } else {
                    Ok((true, None, None))
                };
                session.command_pending = false;
                busy.store(false, Ordering::SeqCst);
                if let Err(error) = &result {
                    session.playback_error = error.clone();
                }
                if mutation || changed {
                    publish_change(&mut session, &mut persistence, &mut publish);
                }
                let snapshot = session.snapshot();
                let response = result.and_then(|(applied, removal, edit_token)| {
                    Ok(SessionReply {
                        snapshot: snapshot?,
                        applied,
                        removal,
                        edit_token,
                    })
                });
                let _ = reply.send(response);
            }
        }
    }
}

#[tauri::command]
pub async fn playback_session_command(
    command: SessionCommand,
    state: State<'_, PlaybackSession>,
) -> Result<SessionReply, String> {
    let receiver = state.request(command)?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "Playback session is unavailable".to_owned())?
    })
    .await
    .map_err(|error| format!("Playback session request failed: {error}"))?
}

#[tauri::command]
pub async fn playback_session_metadata(
    tracks: Vec<MetadataUpdate>,
    state: State<'_, PlaybackSession>,
) -> Result<Option<MetadataDelta>, String> {
    let receiver = state.metadata(tracks)?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "Playback session is unavailable".to_owned())?
    })
    .await
    .map_err(|error| format!("Playback metadata request failed: {error}"))?
}

#[tauri::command]
pub async fn playback_session_progress(
    state: State<'_, PlaybackSession>,
) -> Result<SessionProgress, String> {
    let receiver = state.progress()?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|_| "Playback session is unavailable".to_owned())?
    })
    .await
    .map_err(|error| format!("Playback progress request failed: {error}"))?
}

pub(super) fn system_operation(action: &str) -> Option<SystemOperation> {
    match action {
        "previous" => Some(SystemOperation::Previous),
        "next" => Some(SystemOperation::Next),
        "toggle" => Some(SystemOperation::Toggle),
        "play" => Some(SystemOperation::Play),
        "pause" => Some(SystemOperation::Pause),
        _ => None,
    }
}

pub fn system_command(app: &AppHandle, action: &str) {
    let Some(operation) = system_operation(action) else {
        return;
    };
    let state = app.state::<PlaybackSession>();
    if state.busy.load(Ordering::SeqCst) {
        return;
    }
    match state.request(SessionCommand::System { operation }) {
        Ok(receiver) => {
            tauri::async_runtime::spawn_blocking(move || match receiver.recv() {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => log::warn!("System playback command failed: {error}"),
                Err(error) => log::warn!("System playback command was interrupted: {error}"),
            });
        }
        Err(error) => log::warn!("Could not execute system playback command: {error}"),
    }
}
