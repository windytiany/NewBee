use super::{configuration::Folder, inventory, scanning, SynchronizationState};
use crate::{database::Database, library::model::ImportResult};
use std::{collections::HashSet, path::Path};

const STABILITY_ATTEMPTS: usize = 3;

/// Both manual requests and the filesystem scheduler enter the same reconciliation flow.
pub(super) fn run(
    database: &Database,
    state: &SynchronizationState,
    folders: &[Folder],
    fill_replay_gain: bool,
    mut progress: impl FnMut(usize, usize),
) -> Result<ImportResult, String> {
    let mut result = ImportResult::default();
    let mut pending: Vec<_> = folders.iter().filter(|folder| folder.enabled).collect();
    for attempt in 0..STABILITY_ATTEMPTS {
        let mut visited = HashSet::new();
        let mut snapshots = Vec::new();
        for folder in pending.drain(..) {
            state.status(&folder.path, "scanning", None);
            match inventory::inspect(Path::new(&folder.path)) {
                Ok(snapshot) => {
                    let files: Vec<_> = inventory::audio(&snapshot)
                        .into_iter()
                        .filter(|path| visited.insert(path.clone()))
                        .collect();
                    if attempt == 0 {
                        result.skipped += snapshot.skipped();
                    }
                    snapshots.push((folder, snapshot, files));
                }
                Err(error) => {
                    state.unavailable(&folder.path, error.clone());
                    result.record_failure(Path::new(&folder.path), "discovery", &error);
                }
            }
        }
        let total = snapshots.iter().map(|(_, _, files)| files.len()).sum();
        let mut completed = 0;
        if total == 0 && attempt == 0 {
            progress(0, 0);
        }
        for (folder, before, files) in snapshots {
            if !files.is_empty() {
                scanning::run_with_replay_gain(
                    database,
                    &files,
                    &mut result,
                    fill_replay_gain,
                    |done, _| {
                        if attempt == 0 {
                            progress(completed + done, total);
                        }
                    },
                )
                .inspect_err(|error| {
                    state.status(&folder.path, "error", Some(error.clone()));
                })?;
                completed += files.len();
            }
            match inventory::inspect(Path::new(&folder.path)) {
                Ok(after) if before == after => {
                    state.reconcile(&folder.path, &database.library_track_paths()?);
                    state.status(
                        &folder.path,
                        if result.has_failures_in(Path::new(&folder.path)) {
                            "error"
                        } else if folder.mode == super::configuration::Mode::Continuous {
                            "watching"
                        } else {
                            "idle"
                        },
                        result
                            .has_failures_in(Path::new(&folder.path))
                            .then(|| "部分文件读取失败".into()),
                    );
                }
                Ok(_) if attempt + 1 < STABILITY_ATTEMPTS => pending.push(folder),
                Ok(_) => {
                    let error = "同步期间文件夹持续变化";
                    state.unavailable(&folder.path, error.into());
                    result.record_failure(Path::new(&folder.path), "discovery", error);
                }
                Err(error) => {
                    state.unavailable(&folder.path, error.clone());
                    result.record_failure(Path::new(&folder.path), "discovery", &error);
                }
            }
        }
        if pending.is_empty() {
            break;
        }
    }
    result.flush_failures();
    Ok(result)
}
