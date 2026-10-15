use super::{import_track, record_failure, ImportResult};
use crate::database::Database;
use crate::library::model::MusicLibraryDirectory;
use crate::locking::write::WriteState;
use crate::tracks::discovery::has_supported_extension;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, State};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    operation_id: Option<String>,
    completed: usize,
    total: usize,
}

#[tauri::command]
pub async fn scan_music_library<R: tauri::Runtime>(
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<ImportResult, String> {
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::logging::with_operation(operation_id.clone(), || {
            let _guard = guard;
            log::info!("event=import_started operationId={operation_id:?}");
            use tauri::Manager;
            let database = app.state::<Database>();
            let mut last_update = std::time::Instant::now();
            let result = run_scan(&database, |completed, total| {
                if completed != 0
                    && completed != total
                    && last_update.elapsed() < std::time::Duration::from_millis(100)
                {
                    return;
                }
                last_update = std::time::Instant::now();
                if let Err(error) = app.emit(
                    "library-scan-progress",
                    ScanProgress {
                        operation_id: operation_id.clone(),
                        completed,
                        total,
                    },
                ) {
                    log::warn!("Failed to publish library scan progress: {error}");
                }
            });
            log::info!("event=import_completed operationId={operation_id:?}");
            result
        })
    })
    .await
    .map_err(|error| format!("Music library scan task failed: {error}"))?
}

pub(super) fn run_scan(
    database: &Database,
    mut progress: impl FnMut(usize, usize),
) -> Result<ImportResult, String> {
    let directories = database.list_music_library_directories()?;
    let mut result = ImportResult::default();
    let mut visited_directories = HashSet::new();
    let mut visited_files = HashSet::new();
    let mut files = Vec::new();

    for directory in &directories {
        scan_directory(
            database,
            directory,
            &mut visited_directories,
            &mut visited_files,
            &mut result,
            &mut files,
        );
    }

    progress(0, files.len());
    for (index, path) in files.iter().enumerate() {
        import_track(database, path, &mut result);
        progress(index + 1, files.len());
    }

    for path in database.library_track_paths()? {
        let path = PathBuf::from(path);
        if directories.iter().any(|root| path.starts_with(&root.path))
            && !visited_files.contains(&path)
        {
            record_failure(
                database,
                &mut result,
                &path,
                "previously scanned audio is unavailable",
            );
        }
    }
    Ok(result)
}

fn scan_directory(
    database: &Database,
    directory: &MusicLibraryDirectory,
    visited_directories: &mut HashSet<PathBuf>,
    visited_files: &mut HashSet<PathBuf>,
    result: &mut ImportResult,
    files: &mut Vec<PathBuf>,
) {
    let configured_path = PathBuf::from(&directory.path);
    let root = match fs::canonicalize(&configured_path) {
        Ok(root) if root == configured_path => root,
        Ok(_) => {
            record_failure(
                database,
                result,
                &configured_path,
                "saved directory now resolves through a link",
            );
            return;
        }
        Err(error) => {
            record_failure(database, result, &configured_path, &error.to_string());
            return;
        }
    };

    if !root.is_dir() {
        record_failure(database, result, &root, "saved path is not a directory");
        return;
    }

    let mut pending_directories = vec![root.clone()];
    while let Some(path) = pending_directories.pop() {
        let canonical_path = match fs::canonicalize(&path) {
            Ok(canonical_path) if canonical_path == path && canonical_path.starts_with(&root) => {
                canonical_path
            }
            Ok(_) => {
                result.skipped += 1;
                continue;
            }
            Err(error) => {
                record_failure(database, result, &path, &error.to_string());
                continue;
            }
        };
        if !visited_directories.insert(canonical_path.clone()) {
            continue;
        }

        let entries = match fs::read_dir(&canonical_path) {
            Ok(entries) => entries,
            Err(error) => {
                record_failure(database, result, &path, &error.to_string());
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    record_failure(database, result, &path, &error.to_string());
                    continue;
                }
            };
            let entry_path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    record_failure(database, result, &entry_path, &error.to_string());
                    continue;
                }
            };

            if file_type.is_symlink() {
                result.skipped += 1;
            } else if file_type.is_dir() {
                pending_directories.push(entry_path);
            } else if file_type.is_file() {
                if !has_supported_extension(&entry_path) {
                    result.skipped += 1;
                    continue;
                }
                let canonical_file = match fs::canonicalize(&entry_path) {
                    Ok(canonical_file)
                        if canonical_file == entry_path && canonical_file.starts_with(&root) =>
                    {
                        canonical_file
                    }
                    Ok(_) => {
                        result.skipped += 1;
                        continue;
                    }
                    Err(error) => {
                        record_failure(database, result, &entry_path, &error.to_string());
                        continue;
                    }
                };
                if !visited_files.insert(canonical_file.clone()) {
                    result.skipped += 1;
                    continue;
                }

                files.push(canonical_file);
            } else {
                result.skipped += 1;
            }
        }
    }
}
