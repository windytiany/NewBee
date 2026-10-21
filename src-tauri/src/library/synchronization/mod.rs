pub(crate) mod commands;
pub(crate) mod configuration;
mod inventory;
pub(crate) mod reconciliation;
mod runtime;
mod scanning;
#[cfg(test)]
pub(crate) mod tests;

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

pub(crate) const EVENT: &str = "library-synchronization-changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    path: String,
    phase: &'static str,
    error: Option<String>,
    issues: Option<crate::library::model::ScanIssues>,
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
pub(crate) struct SynchronizationState {
    data: Mutex<Data>,
    stopped: AtomicBool,
}

impl SynchronizationState {
    pub(crate) fn invalidate_paths(&self, affected: impl Fn(&str) -> bool) {
        let mut data = self.data.lock().unwrap_or_else(|error| error.into_inner());
        data.statuses.retain(|path, _| !affected(path));
        data.missing.retain(|path| !affected(path));
        data.acknowledged.retain(|path| !affected(path));
        if data
            .progress
            .as_ref()
            .is_some_and(|progress| affected(&progress.path))
        {
            data.progress = None;
        }
    }

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
                issues: None,
            },
        );
    }

    fn warning(&self, path: &str, issues: crate::library::model::ScanIssues) {
        self.data
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .statuses
            .insert(
                path.into(),
                Status {
                    path: path.into(),
                    phase: "warning",
                    error: None,
                    issues: Some(issues),
                },
            );
    }

    fn progress(&self, progress: Option<Progress>) {
        self.data
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .progress = progress;
    }

    fn unavailable(&self, root: &str, error: String) {
        self.status(root, "unavailable", Some(error));
        self.data
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .missing
            .retain(|path| !Path::new(path).starts_with(root));
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
pub(crate) fn get_library_synchronization(
    state: State<'_, SynchronizationState>,
    settings: State<'_, SettingsState>,
) -> Result<Snapshot, String> {
    let folders = settings.get()?.synchronization_folders;
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
    state: &SynchronizationState,
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
pub(crate) async fn resolve_library_synchronization<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    paths: Vec<String>,
    clean: bool,
) -> Result<usize, String> {
    let guard = app.state::<WriteState>().acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let folders = app.state::<SettingsState>().get()?.synchronization_folders;
        let removed = resolve(
            &app.state::<Database>(),
            &app.state::<SynchronizationState>(),
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
        log::warn!("Could not publish synchronization status: {error}");
    }
}

pub(crate) use runtime::initialize;
