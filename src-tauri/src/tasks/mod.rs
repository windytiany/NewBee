pub(crate) mod exit;

use crate::metadata::revision::{read as revision, Revision};
use crate::{database::Database, locking::WriteState};
use std::{
    cell::RefCell,
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
};
use tauri::Manager;

#[derive(Default)]
struct Queue {
    pending: VecDeque<Entry>,
    restoring: bool,
}
struct Entry {
    id: String,
    fingerprint: String,
    paths: Vec<String>,
    track_ids: Vec<i64>,
    cancelled: Arc<AtomicBool>,
    running: bool,
    expected: Vec<Revision>,
}
impl Queue {
    fn reserve(&mut self, entry: Entry) -> Result<Option<String>, String> {
        if self.restoring {
            return Err("正在恢复备份".into());
        }
        if let Some(existing) = self
            .pending
            .iter()
            .find(|existing| existing.fingerprint == entry.fingerprint)
        {
            return Ok(Some(existing.id.clone()));
        }
        if self.pending.iter().any(|existing| {
            entry
                .track_ids
                .iter()
                .any(|id| existing.track_ids.contains(id))
                || entry.paths.iter().any(|path| existing.paths.contains(path))
        }) {
            return Err("写入正在进行，请完成后重新打开".into());
        }
        if self.pending.iter().any(|existing| existing.id == entry.id) {
            return Err("重复的任务标识".into());
        }
        self.pending.push_back(entry);
        Ok(None)
    }
}
static QUEUE: LazyLock<Mutex<Queue>> = LazyLock::new(Mutex::default);
thread_local! {
    static CANCELLATION: RefCell<Option<Arc<AtomicBool>>> = const { RefCell::new(None) };
}

pub(crate) fn cancellation(id: Option<&str>) -> Result<Option<Arc<AtomicBool>>, String> {
    let queue = QUEUE.lock().map_err(|error| error.to_string())?;
    let entry = queue
        .pending
        .iter()
        .find(|entry| Some(entry.id.as_str()) == id);
    if entry.is_some_and(|entry| !entry.running) {
        return Err("任务尚未轮到执行".into());
    }
    Ok(entry.map(|entry| entry.cancelled.clone()))
}

pub(crate) fn cancelled() -> bool {
    CANCELLATION.with(|flag| {
        flag.borrow()
            .as_ref()
            .is_some_and(|flag| flag.load(Ordering::Acquire))
    })
}

pub(crate) fn scope<T>(id: Option<&str>, action: impl FnOnce() -> T) -> T {
    struct Restore(Option<Arc<AtomicBool>>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CANCELLATION.with(|flag| *flag.borrow_mut() = self.0.take());
        }
    }
    let flag = QUEUE
        .lock()
        .unwrap()
        .pending
        .iter()
        .find(|entry| Some(entry.id.as_str()) == id)
        .map(|entry| entry.cancelled.clone());
    let _restore = Restore(CANCELLATION.with(|current| current.replace(flag)));
    action()
}

pub(crate) fn with_operation<T>(id: Option<String>, action: impl FnOnce() -> T) -> T {
    scope(id.as_deref(), || {
        crate::logging::with_operation(id.clone(), action)
    })
}

pub(crate) fn pending() -> bool {
    let queue = QUEUE.lock().unwrap();
    queue.restoring || !queue.pending.is_empty()
}

fn canonical(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_owned())
}

pub(crate) fn validate(
    database: &Database,
    ids: &[i64],
    operation: Option<&str>,
    expected: &[Revision],
) -> Result<(), String> {
    if expected.is_empty() {
        let queue = QUEUE.lock().unwrap();
        if !queue.restoring && queue.pending.is_empty() {
            return Ok(());
        }
    }
    let paths = ids
        .iter()
        .map(|id| {
            database
                .get_track(*id)
                .map(|track| track.map(|track| canonical(track.path())))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let queue = QUEUE.lock().unwrap();
    if queue.restoring
        || queue.pending.iter().any(|entry| {
            Some(entry.id.as_str()) != operation
                && (ids.iter().any(|id| entry.track_ids.contains(id))
                    || paths
                        .iter()
                        .flatten()
                        .any(|path| entry.paths.contains(path)))
        })
    {
        return Err("写入正在进行，请完成后重新打开".into());
    }
    let own = queue
        .pending
        .iter()
        .find(|entry| Some(entry.id.as_str()) == operation);
    if own.is_some_and(|entry| !entry.running) {
        return Err("任务尚未轮到执行".into());
    }
    let submitted = own.map(|entry| entry.expected.clone()).unwrap_or_default();
    drop(queue);
    for expected in expected.iter().chain(&submitted) {
        if ids.contains(&expected.track_id)
            && revision(database, expected.track_id)? != expected.value
        {
            return Err("曲目信息已更新，请重新打开".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn reserve_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    fingerprint: String,
    track_ids: Vec<i64>,
    paths: Vec<String>,
    expected: Vec<Revision>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        let mut targets = paths.iter().map(|path| canonical(path)).collect::<Vec<_>>();
        for track_id in &track_ids {
            let track = database.get_track(*track_id)?.ok_or("曲目已不存在")?;
            targets.push(canonical(track.path()));
        }
        for expected in &expected {
            if !track_ids.contains(&expected.track_id) {
                return Err("版本检查包含非目标曲目".into());
            }
            if revision(&database, expected.track_id)? != expected.value {
                return Err("曲目信息已更新，请重新打开".into());
            }
        }
        let mut queue = QUEUE.lock().map_err(|error| error.to_string())?;
        queue.reserve(Entry {
            id,
            fingerprint,
            paths: targets,
            track_ids,
            cancelled: Arc::new(AtomicBool::new(false)),
            running: false,
            expected,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn start_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            {
                let queue = QUEUE.lock().map_err(|error| error.to_string())?;
                let entry = queue
                    .pending
                    .iter()
                    .find(|entry| entry.id == id)
                    .ok_or("任务已结束")?;
                if entry.cancelled.load(Ordering::Acquire) {
                    return Err("任务已取消".into());
                }
                if entry.running {
                    return Err("任务已开始".into());
                }
                if queue.pending.front().is_none_or(|entry| entry.id != id) {
                    return Err("任务尚未轮到执行".into());
                }
            }
            // Automatic synchronization already in flight may still own the writer.
            if app.state::<WriteState>().available() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let mut queue = QUEUE.lock().map_err(|error| error.to_string())?;
        let entry = queue
            .pending
            .front_mut()
            .filter(|entry| entry.id == id)
            .ok_or("任务已结束")?;
        if entry.cancelled.load(Ordering::Acquire) {
            return Err("任务已取消".into());
        }
        entry.running = true;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn cancel_task(id: String) -> Result<(), String> {
    let queue = QUEUE.lock().map_err(|error| error.to_string())?;
    if let Some(entry) = queue.pending.iter().find(|entry| entry.id == id) {
        entry.cancelled.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn release_task(id: String) -> Result<(), String> {
    QUEUE
        .lock()
        .map_err(|error| error.to_string())?
        .pending
        .retain(|entry| entry.id != id);
    Ok(())
}

#[tauri::command]
pub(crate) fn occupied_tracks<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    track_ids: Vec<i64>,
) -> Result<bool, String> {
    let database = app.state::<Database>();
    let paths = track_ids
        .iter()
        .map(|id| {
            database
                .get_track(*id)
                .map(|track| track.map(|track| canonical(track.path())))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let queue = QUEUE.lock().map_err(|error| error.to_string())?;
    Ok(queue.restoring
        || queue.pending.iter().any(|entry| {
            track_ids.iter().any(|id| entry.track_ids.contains(id))
                || paths
                    .iter()
                    .flatten()
                    .any(|path| entry.paths.contains(path))
        }))
}

pub(crate) struct RestoreGuard(bool);
pub(crate) fn restoring() -> Result<RestoreGuard, String> {
    let mut queue = QUEUE.lock().map_err(|error| error.to_string())?;
    if queue.restoring || !queue.pending.is_empty() {
        return Err("请等待后台任务结束".into());
    }
    queue.restoring = true;
    Ok(RestoreGuard(false))
}
impl RestoreGuard {
    pub(crate) fn commit(&mut self) {
        self.0 = true;
    }
}
impl Drop for RestoreGuard {
    fn drop(&mut self) {
        if !self.0 {
            QUEUE.lock().unwrap().restoring = false;
        }
    }
}

#[cfg(test)]
mod tests;
