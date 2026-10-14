use crate::database::{tracks::confirmation::Confirmation, Database};
use std::collections::{HashSet, VecDeque};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const BATCH_SIZE: usize = 16;
const WRITE_WAIT: Duration = Duration::from_millis(50);

#[derive(Default)]
struct Queue {
    waiting: VecDeque<i64>,
    scheduled: HashSet<i64>,
    running: bool,
    stopped: bool,
}

#[derive(Default)]
pub(crate) struct SchedulingState(Mutex<Queue>);

impl SchedulingState {
    pub(crate) fn prioritize(&self, id: i64) {
        let mut queue = self.0.lock().unwrap();
        if let Some(index) = queue.waiting.iter().position(|candidate| *candidate == id) {
            queue.waiting.remove(index);
            queue.waiting.push_front(id);
        }
    }

    pub(crate) fn stop(&self) {
        let mut queue = self.0.lock().unwrap();
        queue.stopped = true;
        queue.waiting.clear();
    }

    fn enqueue(&self, ids: impl IntoIterator<Item = i64>) -> bool {
        let mut queue = self.0.lock().unwrap();
        if queue.stopped {
            return false;
        }
        for id in ids {
            if queue.scheduled.insert(id) {
                queue.waiting.push_back(id);
            }
        }
        if queue.running || queue.waiting.is_empty() {
            return false;
        }
        queue.running = true;
        true
    }

    fn next(&self) -> Option<i64> {
        self.0.lock().unwrap().waiting.pop_front()
    }

    fn finish(&self, ids: &[i64]) -> bool {
        let mut queue = self.0.lock().unwrap();
        for id in ids {
            queue.scheduled.remove(id);
        }
        if queue.stopped || queue.waiting.is_empty() {
            queue.running = false;
            return false;
        }
        true
    }
}

pub(crate) fn schedule<R: Runtime>(app: &AppHandle<R>, ids: impl IntoIterator<Item = i64>) {
    if !app.state::<SchedulingState>().enqueue(ids) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || drain(&app));
}

pub(super) fn initialize<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match app.state::<Database>().pending_track_ids() {
            Ok(ids) => schedule(&app, ids),
            Err(error) => log::warn!("Could not resume track confirmation: {error}"),
        }
    });
}

fn drain<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<SchedulingState>();
    loop {
        let database = app.state::<Database>();
        let mut ids = Vec::new();
        let mut batch = Vec::new();
        for _ in 0..BATCH_SIZE {
            let Some(id) = state.next() else {
                break;
            };
            ids.push(id);
            match database.pending_track(id) {
                Ok(Some((path, revision))) => {
                    let snapshot = super::scanning::scan(&database, std::path::Path::new(&path));
                    batch.push(Confirmation {
                        id,
                        revision,
                        path,
                        snapshot,
                    });
                }
                Ok(None) => {}
                Err(error) => log::warn!("Could not read pending track {id}: {error}"),
            }
        }
        // File inspection does not hold the global write gate. Foreground edits
        // can complete while reading; confirmation rechecks pending state inside
        // its transaction. Only publication waits for writes/backups to finish.
        let guard = loop {
            if state.0.lock().unwrap().stopped {
                state.finish(&ids);
                return;
            }
            match app.state::<crate::locking::write::WriteState>().acquire() {
                Ok(guard) => break guard,
                Err(_) => std::thread::sleep(WRITE_WAIT),
            }
        };
        let results = match database.confirm_tracks(batch) {
            Ok(results) => results,
            Err(error) => {
                log::warn!("Could not confirm track batch: {error}");
                ids.iter()
                    .map(|id| super::model::TrackReadResult {
                        track_id: *id,
                        database_updated: false,
                        error: Some(error.clone()),
                    })
                    .collect()
            }
        };
        if !results.is_empty() {
            if let Err(error) = app.emit("tracks-confirmed", &results) {
                log::warn!("Could not publish track confirmations: {error}");
            }
        }
        drop(guard);
        if !state.finish(&ids) {
            return;
        }
        // Give foreground writes an opportunity between bounded transactions.
        std::thread::sleep(WRITE_WAIT);
    }
}

#[cfg(test)]
#[path = "scheduling/performance.rs"]
mod performance;
#[cfg(test)]
#[path = "scheduling/tests.rs"]
mod tests;
