use super::{
    configuration::{Folder, Mode},
    inventory::{self, Inventory},
    publish, MonitoringState,
};
use crate::{
    database::Database,
    library::import::{directory::scanning, ImportResult},
    locking::write::WriteState,
    settings::SettingsState,
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        atomic::Ordering,
        mpsc::{self, SyncSender},
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const SETTLE: Duration = Duration::from_secs(1);
const RECONCILE: Duration = Duration::from_secs(30);
const MAX_ATTEMPTS: u8 = 3;

struct Work {
    folder: Folder,
    due: Option<Instant>,
    candidate: Option<Inventory>,
    attempts: u8,
    watcher: Option<RecommendedWatcher>,
    watch_error: Option<String>,
}

impl Work {
    fn new(folder: Folder) -> Self {
        Self {
            folder,
            due: Some(Instant::now()),
            candidate: None,
            attempts: 0,
            watcher: None,
            watch_error: None,
        }
    }

    fn watch(&mut self, sender: &SyncSender<()>) {
        if !self.folder.enabled || self.folder.mode != Mode::Continuous || self.watcher.is_some() {
            return;
        }
        let sender = sender.clone();
        let result = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            match event {
                Ok(event) if event.kind.is_access() => return,
                Err(error) => log::warn!("Monitoring event failed: {error}"),
                _ => {}
            }
            // One wakeup covers all pending filesystem changes.
            let _ = sender.try_send(());
        })
        .and_then(|mut watcher| {
            watcher.watch(Path::new(&self.folder.path), RecursiveMode::Recursive)?;
            Ok(watcher)
        });
        match result {
            Ok(watcher) => {
                self.watcher = Some(watcher);
                self.watch_error = None;
            }
            Err(error) => {
                self.watch_error = Some(error.to_string());
            }
        }
    }

    fn process<R: tauri::Runtime>(&mut self, app: &tauri::AppHandle<R>) -> Result<bool, String> {
        if !self.folder.enabled {
            self.watcher = None;
            self.due = None;
            return Ok(false);
        }
        let state = app.state::<MonitoringState>();
        let inventory = match inventory::inspect(Path::new(&self.folder.path)) {
            Ok(inventory) => inventory,
            Err(error) => {
                state.status(&self.folder.path, "unavailable", Some(error));
                self.watcher = None;
                self.candidate = None;
                state
                    .data
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .missing
                    .retain(|path| !Path::new(path).starts_with(&self.folder.path));
                self.due = Some(Instant::now() + RECONCILE);
                return Ok(false);
            }
        };
        if self.candidate.as_ref() != Some(&inventory) {
            self.candidate = Some(inventory);
            self.attempts = 0;
            self.due = Some(Instant::now() + SETTLE);
            state.status(&self.folder.path, "scanning", None);
            return Ok(false);
        }
        let Ok(_guard) = app.state::<WriteState>().acquire() else {
            self.due = Some(Instant::now() + SETTLE);
            return Ok(false);
        };
        // A configuration edit may have happened during the traversal.
        if !app
            .state::<SettingsState>()
            .get()?
            .monitoring_folders
            .contains(&self.folder)
        {
            return Ok(false);
        }
        let database = app.state::<Database>();
        let mut result = ImportResult::default();
        let exhausted = self.attempts >= MAX_ATTEMPTS;
        if !exhausted {
            self.attempts += 1;
            scanning::run_with_replay_gain(
                &database,
                &inventory::audio(&inventory),
                &mut result,
                app.state::<SettingsState>().get()?.scan_replay_gain,
                |_, _| {},
            )?;
        }
        if result.added + result.updated > 0 {
            if let Err(error) = app.emit("library-monitoring-imported", &result) {
                log::warn!("Could not publish monitored import: {error}");
            }
        }
        if inventory::inspect(Path::new(&self.folder.path)).as_ref() != Ok(&inventory) {
            self.candidate = None;
            self.due = Some(Instant::now() + SETTLE);
            return Ok(result.added + result.updated > 0);
        }
        state.reconcile(&self.folder.path, &database.library_track_paths()?);
        let failed = result.failed > 0 || exhausted;
        if failed {
            state.status(
                &self.folder.path,
                "error",
                Some("部分文件读取失败，请查看日志".into()),
            );
        } else if let Some(error) = &self.watch_error {
            state.status(&self.folder.path, "error", Some(error.clone()));
        } else {
            state.status(
                &self.folder.path,
                if self.folder.mode == Mode::Continuous {
                    "watching"
                } else {
                    "idle"
                },
                None,
            );
        }
        self.due = if failed && self.attempts < MAX_ATTEMPTS {
            Some(Instant::now() + SETTLE)
        } else if self.folder.mode == Mode::Continuous {
            Some(Instant::now() + RECONCILE)
        } else {
            None
        };
        // Successful imports do not consume the retry budget.
        if !failed {
            self.attempts = 0;
        }
        Ok(result.added + result.updated > 0)
    }
}

fn configure(work: &mut BTreeMap<String, Work>, folders: &[Folder]) {
    work.retain(|path, _| {
        folders
            .iter()
            .any(|folder| folder.enabled && folder.path == *path)
    });
    for folder in folders.iter().filter(|folder| folder.enabled) {
        if work
            .get(&folder.path)
            .is_none_or(|entry| entry.folder != *folder)
        {
            work.insert(folder.path.clone(), Work::new(folder.clone()));
        }
    }
}

pub(crate) fn initialize<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), std::io::Error> {
    let app = app.clone();
    std::thread::Builder::new()
        .name("library-monitoring".into())
        .spawn(move || {
            let (sender, receiver) = mpsc::sync_channel(1);
            let mut work: BTreeMap<String, Work> = BTreeMap::new();
            loop {
                if app
                    .state::<MonitoringState>()
                    .stopped
                    .load(Ordering::Acquire)
                {
                    break;
                }
                let folders = match app.state::<SettingsState>().get() {
                    Ok(settings) => settings.monitoring_folders,
                    Err(error) => {
                        log::error!("Could not load monitoring configuration: {error}");
                        break;
                    }
                };
                configure(&mut work, &folders);
                {
                    let state = app.state::<MonitoringState>();
                    let mut data = state.data.lock().unwrap_or_else(|error| error.into_inner());
                    data.statuses.retain(|path, _| work.contains_key(path));
                    data.missing.retain(|path| {
                        folders.iter().any(|folder| {
                            folder.enabled && Path::new(path).starts_with(&folder.path)
                        })
                    });
                    data.acknowledged.retain(|path| {
                        folders
                            .iter()
                            .any(|folder| Path::new(path).starts_with(&folder.path))
                    });
                }
                let changed = receiver.try_recv().is_ok();
                for entry in work.values_mut() {
                    if changed && entry.folder.mode == Mode::Continuous {
                        entry.due = Some(Instant::now() + SETTLE);
                    }
                    if entry.due.is_some_and(|due| due <= Instant::now()) {
                        entry.watch(&sender);
                        let attempts = entry.attempts;
                        if let Err(error) = entry.process(&app) {
                            log::warn!("Monitoring failed for {}: {error}", entry.folder.path);
                            app.state::<MonitoringState>().status(
                                &entry.folder.path,
                                "error",
                                Some(error),
                            );
                            entry.attempts = entry.attempts.max(attempts.saturating_add(1));
                            entry.due = if entry.attempts < MAX_ATTEMPTS {
                                Some(Instant::now() + SETTLE)
                            } else if entry.folder.mode == Mode::Continuous {
                                Some(Instant::now() + RECONCILE)
                            } else {
                                None
                            };
                        }
                        publish(&app);
                    }
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        })?;
    Ok(())
}

#[cfg(test)]
#[path = "tests/runtime.rs"]
mod tests;
