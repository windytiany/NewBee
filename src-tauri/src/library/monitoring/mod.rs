pub(crate) mod configuration;
mod inventory;
mod runtime;
#[cfg(test)]
mod tests;

use crate::{database::Database, locking::WriteState, settings::SettingsState};
use configuration::Folder;
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State};

pub(crate) const EVENT: &str = "library-monitoring-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    path: String,
    phase: &'static str,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    path: String,
    completed: usize,
    total: usize,
}

#[derive(Default)]
struct Data {
    progress: Option<Progress>,
    statuses: BTreeMap<String, Status>,
    missing: BTreeSet<String>,
    acknowledged: BTreeSet<String>,
}

#[derive(Default)]
pub(crate) struct MonitoringState {
    data: Mutex<Data>,
    stopped: AtomicBool,
}

impl MonitoringState {
    pub(crate) fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    fn status(&self, path: &str, phase: &'static str, error: Option<String>) {
        let mut data = self.data.lock().unwrap_or_else(|error| error.into_inner());
        data.statuses.insert(
            path.into(),
            Status {
                path: path.into(),
                phase,
                error,
            },
        );
    }

    fn progress(&self, progress: Option<Progress>) {
        self.data
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .progress = progress;
    }

    fn reconcile(&self, root: &str, paths: &[String]) {
        let mut data = self.data.lock().unwrap_or_else(|error| error.into_inner());
        // A returned file can prompt again if it disappears later.
        data.acknowledged.retain(|path| {
            !Path::new(path).starts_with(root) || inventory::missing(Path::new(path))
        });
        data.missing
            .retain(|path| !Path::new(path).starts_with(root));
        for path in paths {
            if Path::new(path).starts_with(root)
                && inventory::missing(Path::new(path))
                && !data.acknowledged.contains(path)
            {
                data.missing.insert(path.clone());
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    progress: Option<Progress>,
    statuses: Vec<Status>,
    missing: Vec<String>,
}

#[tauri::command]
pub(crate) fn get_library_monitoring(
    state: State<'_, MonitoringState>,
    settings: State<'_, SettingsState>,
) -> Result<Snapshot, String> {
    let folders = settings.get()?.monitoring_folders;
    let data = state.data.lock().map_err(|error| error.to_string())?;
    Ok(Snapshot {
        progress: data.progress.clone(),
        statuses: data
            .statuses
            .values()
            .filter(|status| {
                folders
                    .iter()
                    .any(|folder| folder.enabled && folder.path == status.path)
            })
            .cloned()
            .collect(),
        missing: data
            .missing
            .iter()
            .filter(|path| {
                folders
                    .iter()
                    .any(|folder| folder.enabled && Path::new(path).starts_with(&folder.path))
            })
            .cloned()
            .collect(),
    })
}

fn resolve(
    database: &Database,
    state: &MonitoringState,
    folders: &[Folder],
    paths: &[String],
    clean: bool,
) -> Result<usize, String> {
    let mut data = state.data.lock().map_err(|error| error.to_string())?;
    let mut removed = 0;
    // Complete traversal is required before offering or confirming removal.
    let available: Vec<_> = folders
        .iter()
        .filter(|folder| folder.enabled && inventory::inspect(Path::new(&folder.path)).is_ok())
        .collect();
    for path in paths {
        if !data.missing.contains(path) {
            continue;
        }
        if clean
            && available
                .iter()
                .any(|folder| Path::new(path).starts_with(&folder.path))
            && inventory::missing(Path::new(path))
        {
            removed += database.remove_library_path(path)?;
        }
        data.missing.remove(path);
        if !clean {
            data.acknowledged.insert(path.clone());
        }
    }
    Ok(removed)
}

#[tauri::command]
pub(crate) async fn resolve_library_monitoring<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    clean: bool,
) -> Result<usize, String> {
    let guard = app.state::<WriteState>().acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let folders = app.state::<SettingsState>().get()?.monitoring_folders;
        let removed = resolve(
            &app.state::<Database>(),
            &app.state::<MonitoringState>(),
            &folders,
            &paths,
            clean,
        )?;
        publish(&app);
        Ok(removed)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn publish<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Err(error) = app.emit(EVENT, ()) {
        log::warn!("Could not publish monitoring status: {error}");
    }
}

pub(crate) use runtime::initialize;
