use super::{
    configuration::{Folder, Mode},
    inventory::{self, Inventory},
    publish, reconciliation, SynchronizationState,
};
use crate::{database::Database, locking::WriteState, settings::SettingsState};
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

struct Work {
    folder: Folder,
    due: Option<Instant>,
    candidate: Option<Inventory>,
    failed: bool,
    watcher: Option<RecommendedWatcher>,
    watch_error: Option<String>,
}

impl Work {
    fn new(folder: Folder) -> Self {
        let due = (folder.mode != Mode::Manual).then(Instant::now);
        Self {
            folder,
            due,
            candidate: None,
            failed: false,
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
                Err(error) => log::warn!("Synchronization event failed: {error}"),
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
        let state = app.state::<SynchronizationState>();
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
            self.failed = false;
            self.due = Some(Instant::now() + SETTLE);
            state.status(&self.folder.path, "scanning", None);
            return Ok(false);
        }
        self.due = (self.folder.mode == Mode::Continuous).then(|| Instant::now() + RECONCILE);
        // A failed inventory is only eligible again after a filesystem change
        // or an explicit scan, never because of a timer or watcher wakeup.
        if self.failed {
            return Ok(false);
        }
        if crate::tasks::pending() {
            self.due = Some(Instant::now() + SETTLE);
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
            .synchronization_folders
            .contains(&self.folder)
        {
            return Ok(false);
        }
        let database = app.state::<Database>();
        self.failed = true;
        let fill_replay_gain = app.state::<SettingsState>().get()?.scan_replay_gain;
        let mut last_update = Instant::now();
        let scanned = reconciliation::run(
            &database,
            &state,
            std::slice::from_ref(&self.folder),
            fill_replay_gain,
            |completed, total| {
                if completed != 0
                    && completed != total
                    && last_update.elapsed() < Duration::from_millis(100)
                {
                    return;
                }
                last_update = Instant::now();
                state.progress(Some(super::Progress {
                    path: self.folder.path.clone(),
                    completed,
                    total,
                }));
                publish(app);
            },
        );
        state.progress(None);
        publish(app);
        let result = scanned?;
        self.failed = result.failed > 0;
        if result.added + result.updated > 0 {
            if let Err(error) = app.emit("library-synchronization-imported", &result) {
                log::warn!("Could not publish monitored import: {error}");
            }
        }
        if !self.failed {
            if let Some(error) = &self.watch_error {
                state.status(&self.folder.path, "error", Some(error.clone()));
            }
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
        .name("library-synchronization".into())
        .spawn(move || {
            let (sender, receiver) = mpsc::sync_channel(1);
            let mut work: BTreeMap<String, Work> = BTreeMap::new();
            loop {
                if app
                    .state::<SynchronizationState>()
                    .stopped
                    .load(Ordering::Acquire)
                {
                    break;
                }
                let folders = match app.state::<SettingsState>().get() {
                    Ok(settings) => settings.synchronization_folders,
                    Err(error) => {
                        log::error!("Could not load synchronization configuration: {error}");
                        break;
                    }
                };
                configure(&mut work, &folders);
                {
                    let state = app.state::<SynchronizationState>();
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
                        if let Err(error) = entry.process(&app) {
                            log::warn!("Synchronization failed for {}: {error}", entry.folder.path);
                            app.state::<SynchronizationState>().status(
                                &entry.folder.path,
                                "error",
                                Some(error),
                            );
                            entry.due = if entry.folder.mode == Mode::Continuous {
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
