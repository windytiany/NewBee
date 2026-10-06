use super::{download, LyricsContent, LyricsProvider};
use crate::{
    database::{write::WriteGuard, write::WriteState, Database, TrackDetails},
    metadata::{
        model::{
            normalize_changes, validate_track_ids, LyricsMarkAction, MetadataChange, MetadataField,
        },
        save::save_track,
        MetadataSaveResult,
    },
    settings::SettingsState,
};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};

const COOPERATION_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TrackKind {
    Available,
    Instrumental,
    Missing,
    Failed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackOutcome {
    track_id: i64,
    kind: TrackKind,
    result: Option<MetadataSaveResult>,
    error: Option<String>,
}

impl TrackOutcome {
    fn failed(track_id: i64, error: String) -> Self {
        Self {
            track_id,
            kind: TrackKind::Failed,
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BatchStatus {
    Completed,
    Cancelled,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchSummary {
    batch_id: u64,
    status: BatchStatus,
    results: Vec<TrackOutcome>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum BatchEvent {
    Started {
        batch_id: u64,
        total: usize,
    },
    SaveRequested {
        batch_id: u64,
        step_id: u64,
        track_id: i64,
        path: String,
        content: TrackKind,
    },
    TrackCompleted {
        batch_id: u64,
        outcome: TrackOutcome,
    },
}

enum Phase {
    AwaitingAuthorization,
    Authorized,
    Writing,
    AwaitingCompletion(MetadataSaveResult),
    Settled {
        result: Option<MetadataSaveResult>,
        error: Option<String>,
    },
}

struct Round {
    step_id: u64,
    deadline: Instant,
    phase: Phase,
}

struct Task {
    id: u64,
    cancelled: AtomicBool,
    round: Mutex<Option<Round>>,
    changed: Condvar,
}

impl Task {
    fn lock(&self) -> Result<MutexGuard<'_, Option<Round>>, String> {
        self.round.lock().map_err(|error| error.to_string())
    }

    fn authorize(&self, step_id: u64) -> Result<MetadataSaveResult, String> {
        let mut round = self.lock()?;
        let current = round
            .as_mut()
            .filter(|round| round.step_id == step_id)
            .ok_or_else(|| "歌词保存请求已过期".to_owned())?;
        if self.cancelled.load(Ordering::Acquire)
            || Instant::now() >= current.deadline
            || !matches!(current.phase, Phase::AwaitingAuthorization)
        {
            return Err("歌词保存请求已取消、过期或已经授权".to_owned());
        }
        current.phase = Phase::Authorized;
        self.changed.notify_all();
        loop {
            match round
                .as_ref()
                .filter(|round| round.step_id == step_id)
                .map(|round| &round.phase)
            {
                Some(Phase::AwaitingCompletion(result)) => return Ok(result.clone()),
                Some(Phase::Authorized | Phase::Writing) => {
                    round = self
                        .changed
                        .wait(round)
                        .map_err(|error| error.to_string())?;
                }
                _ => return Err("歌词保存请求已结束".to_owned()),
            }
        }
    }

    fn complete(&self, step_id: u64, error: Option<String>) -> Result<(), String> {
        let mut round = self.lock()?;
        let current = round
            .as_mut()
            .filter(|round| round.step_id == step_id)
            .ok_or_else(|| "歌词保存请求已过期".to_owned())?;
        if Instant::now() >= current.deadline {
            return Err("歌词保存请求已过期".to_owned());
        }
        let result = match &current.phase {
            Phase::AwaitingAuthorization if error.is_some() => None,
            Phase::AwaitingCompletion(result) => Some(result.clone()),
            _ => return Err("歌词保存请求尚未提交或已经结束".to_owned()),
        };
        current.phase = Phase::Settled { result, error };
        self.changed.notify_all();
        Ok(())
    }

    fn wait<'a>(
        &self,
        round: MutexGuard<'a, Option<Round>>,
        deadline: Instant,
    ) -> Result<MutexGuard<'a, Option<Round>>, String> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("前端歌词保存协作超时".to_owned());
        }
        self.changed
            .wait_timeout(round, remaining)
            .map(|(round, _)| round)
            .map_err(|error| error.to_string())
    }

    fn save(
        &self,
        database: &Database,
        step_id: u64,
        track_id: i64,
        content: LyricsContent,
        timeout: Duration,
    ) -> RoundOutcome {
        let operation = (|| {
            let mut round = self.lock()?;
            let deadline = round
                .as_ref()
                .filter(|round| round.step_id == step_id)
                .map(|round| round.deadline)
                .ok_or_else(|| "歌词保存请求已过期".to_owned())?;
            loop {
                if self.cancelled.load(Ordering::Acquire) {
                    return Ok(RoundOutcome::Cancelled);
                }
                match round.as_mut().map(|round| &mut round.phase) {
                    Some(phase @ Phase::Authorized) => {
                        *phase = Phase::Writing;
                        break;
                    }
                    Some(Phase::Settled { result, error }) => {
                        return Ok(RoundOutcome::Finished {
                            result: result.clone(),
                            error: error.clone(),
                        });
                    }
                    Some(Phase::AwaitingAuthorization) => round = self.wait(round, deadline)?,
                    _ => return Err("歌词保存请求状态无效".to_owned()),
                }
            }
            drop(round);
            // No cooperation deadline or cancellation can interrupt an accepted commit.
            let (changes, action) = match content {
                LyricsContent::Available { text } => (
                    vec![MetadataChange {
                        field: MetadataField::Lyrics,
                        value: Some(text),
                    }],
                    LyricsMarkAction::Keep,
                ),
                LyricsContent::Instrumental => (vec![], LyricsMarkAction::Mark),
                LyricsContent::Missing => return Err("未找到歌词，不能保存".to_owned()),
            };
            let result = save_track(database, track_id, &changes, action, None);
            let deadline = Instant::now() + timeout;
            let mut round = self.lock()?;
            let current = round
                .as_mut()
                .filter(|round| round.step_id == step_id)
                .ok_or_else(|| "歌词保存请求已结束".to_owned())?;
            current.deadline = deadline;
            current.phase = Phase::AwaitingCompletion(result.clone());
            self.changed.notify_all();
            loop {
                if let Some(Round {
                    phase: Phase::Settled { result, error },
                    ..
                }) = round.as_ref()
                {
                    return Ok(RoundOutcome::Finished {
                        result: result.clone(),
                        error: error.clone(),
                    });
                }
                round = match self.wait(round, deadline) {
                    Ok(round) => round,
                    Err(error) => {
                        return Ok(RoundOutcome::Failed {
                            result: Some(result),
                            error,
                        })
                    }
                };
            }
        })();
        operation.unwrap_or_else(|error| RoundOutcome::Failed {
            result: None,
            error,
        })
    }
}

enum RoundOutcome {
    Finished {
        result: Option<MetadataSaveResult>,
        error: Option<String>,
    },
    Cancelled,
    Failed {
        result: Option<MetadataSaveResult>,
        error: String,
    },
}

pub(crate) struct BatchRequest {
    track_ids: Vec<i64>,
    providers: Vec<LyricsProvider>,
}

pub(crate) struct LyricsBatchState {
    active: Mutex<Option<Arc<Task>>>,
    next_id: AtomicU64,
    timeout: Duration,
}

impl Default for LyricsBatchState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            next_id: AtomicU64::new(0),
            timeout: COOPERATION_TIMEOUT,
        }
    }
}

// The running operation owns the write guard, including on errors or unwinding.
struct RunLease<'a> {
    state: &'a LyricsBatchState,
    task: Arc<Task>,
    guard: Option<WriteGuard>,
}

impl Drop for RunLease<'_> {
    fn drop(&mut self) {
        let mut active = self
            .state
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut round = self
            .task
            .round
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *round = None;
        self.task.changed.notify_all();
        drop(self.guard.take());
        *active = None;
    }
}

impl LyricsBatchState {
    fn task(&self, batch_id: u64) -> Result<Arc<Task>, String> {
        self.active
            .lock()
            .map_err(|error| error.to_string())?
            .as_ref()
            .filter(|task| task.id == batch_id)
            .cloned()
            .ok_or_else(|| "歌词下载任务已结束".to_owned())
    }

    fn cancel(&self, batch_id: u64) -> Result<(), String> {
        let task = self.task(batch_id)?;
        // Serialize cancellation with accepting a commit, never with its file I/O.
        let _round = task.lock()?;
        task.cancelled.store(true, Ordering::Release);
        task.changed.notify_all();
        Ok(())
    }

    fn run(
        &self,
        database: &Database,
        write: &WriteState,
        request: BatchRequest,
        send: impl Fn(BatchEvent) -> Result<(), String>,
        lookup: impl Fn(&TrackDetails, &[LyricsProvider], &AtomicBool) -> Result<LyricsContent, String>,
    ) -> Result<BatchSummary, String> {
        let ids = validate_track_ids(&request.track_ids)?;
        if request.providers.is_empty() {
            return Err("请先在设置中启用歌词来源".to_owned());
        }
        let lease = {
            let mut active = self.active.lock().map_err(|error| error.to_string())?;
            if active.is_some() {
                return Err("已有歌词下载任务正在运行".to_owned());
            }
            let guard = write.acquire()?;
            let task = Arc::new(Task {
                id: self.next_id.fetch_add(1, Ordering::Relaxed) + 1,
                cancelled: AtomicBool::new(false),
                round: Mutex::new(None),
                changed: Condvar::new(),
            });
            *active = Some(Arc::clone(&task));
            RunLease {
                state: self,
                task,
                guard: Some(guard),
            }
        };
        let task = &lease.task;
        let mut summary = BatchSummary {
            batch_id: task.id,
            status: BatchStatus::Completed,
            results: vec![],
            error: None,
        };
        let operation = (|| {
            send(BatchEvent::Started {
                batch_id: task.id,
                total: ids.len(),
            })?;
            for (index, track_id) in ids.into_iter().enumerate() {
                if task.cancelled.load(Ordering::Acquire) {
                    break;
                }
                let track = database.get_track(track_id).and_then(|track| {
                    track.ok_or_else(|| format!("曲目 {track_id} 已不在数据库中"))
                });
                let found = track
                    .as_ref()
                    .map_err(Clone::clone)
                    .and_then(|track| lookup(track, &request.providers, &task.cancelled));
                if task.cancelled.load(Ordering::Acquire) {
                    break;
                }
                let mut fatal = None;
                let outcome = match found.and_then(validate_content) {
                    Err(error) => TrackOutcome::failed(track_id, error),
                    Ok(LyricsContent::Missing) => TrackOutcome {
                        track_id,
                        kind: TrackKind::Missing,
                        result: None,
                        error: None,
                    },
                    Ok(content) => {
                        let kind = if matches!(content, LyricsContent::Instrumental) {
                            TrackKind::Instrumental
                        } else {
                            TrackKind::Available
                        };
                        let step_id = index as u64 + 1;
                        *task.lock()? = Some(Round {
                            step_id,
                            deadline: Instant::now() + self.timeout,
                            phase: Phase::AwaitingAuthorization,
                        });
                        send(BatchEvent::SaveRequested {
                            batch_id: task.id,
                            step_id,
                            track_id,
                            path: track.as_ref().map_err(Clone::clone)?.path().to_owned(),
                            content: kind,
                        })?;
                        let saved = task.save(database, step_id, track_id, content, self.timeout);
                        *task.lock()? = None;
                        task.changed.notify_all();
                        match saved {
                            RoundOutcome::Cancelled => break,
                            RoundOutcome::Finished { result, error } => TrackOutcome {
                                track_id,
                                kind,
                                result,
                                error,
                            },
                            RoundOutcome::Failed { result, error } => {
                                // An unstarted commit is not a failed track; the batch error explains it.
                                if result.is_none() {
                                    return Err(error);
                                }
                                fatal = Some(error);
                                TrackOutcome {
                                    track_id,
                                    kind,
                                    result,
                                    error: None,
                                }
                            }
                        }
                    }
                };
                summary.results.push(outcome.clone());
                send(BatchEvent::TrackCompleted {
                    batch_id: task.id,
                    outcome,
                })?;
                if let Some(error) = fatal {
                    return Err(error);
                }
            }
            Ok::<_, String>(())
        })();
        if let Err(error) = operation {
            summary.status = BatchStatus::Failed;
            summary.error = Some(error);
        } else if task.cancelled.load(Ordering::Acquire) {
            summary.status = BatchStatus::Cancelled;
        }
        Ok(summary)
    }
}

fn validate_content(content: LyricsContent) -> Result<LyricsContent, String> {
    if let LyricsContent::Available { text } = content {
        if text.trim().is_empty() || text.len() > 1024 * 1024 {
            return Err("歌词为空或过大，原文件未修改".to_owned());
        }
        let mut changes = [MetadataChange {
            field: MetadataField::Lyrics,
            value: Some(text),
        }];
        normalize_changes(&mut changes)?;
        Ok(LyricsContent::Available {
            text: changes[0]
                .value
                .take()
                .ok_or_else(|| "歌词为空，原文件未修改".to_owned())?,
        })
    } else {
        Ok(content)
    }
}

#[tauri::command]
pub(crate) async fn run_lyrics_download(
    track_ids: Vec<i64>,
    on_progress: Channel<BatchEvent>,
    app: tauri::AppHandle,
) -> Result<BatchSummary, String> {
    let providers = download::providers(&app.state::<SettingsState>())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<LyricsBatchState>().run(
            &app.state::<Database>(),
            &app.state::<WriteState>(),
            BatchRequest {
                track_ids,
                providers,
            },
            |event| {
                on_progress
                    .send(event)
                    .map_err(|error| format!("歌词任务通信失败：{error}"))
            },
            download::automatic,
        )
    })
    .await
    .map_err(|error| format!("歌词下载任务失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn commit_lyrics_download_step(
    batch_id: u64,
    step_id: u64,
    app: tauri::AppHandle,
) -> Result<MetadataSaveResult, String> {
    let task = app.state::<LyricsBatchState>().task(batch_id)?;
    tauri::async_runtime::spawn_blocking(move || task.authorize(step_id))
        .await
        .map_err(|error| format!("歌词保存任务失败：{error}"))?
}

#[tauri::command]
pub(crate) fn complete_lyrics_download_step(
    batch_id: u64,
    step_id: u64,
    error: Option<String>,
    state: tauri::State<'_, LyricsBatchState>,
) -> Result<(), String> {
    state.task(batch_id)?.complete(step_id, error)
}

#[tauri::command]
pub(crate) fn cancel_lyrics_download(
    batch_id: u64,
    state: tauri::State<'_, LyricsBatchState>,
) -> Result<(), String> {
    state.cancel(batch_id)
}

#[cfg(test)]
#[path = "tests/batch.rs"]
mod tests;
