use crate::{database::Database, locking::write::WriteState, metadata::files::FileTrack};
use serde::Serialize;
use std::{collections::HashSet, path::Path};
use tauri::{Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileResult {
    path: String,
    success: bool,
    skipped: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxRead {
    tracks: Vec<InboxTrack>,
    failures: Vec<FileResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxTrack {
    #[serde(flatten)]
    file: FileTrack,
    added_at: i64,
}

fn refresh(database: &Database) -> Result<InboxRead, String> {
    let mut tracks = Vec::new();
    let mut failures = Vec::new();
    for (path, added_at) in database.inbox_entries()? {
        match FileTrack::read(&path) {
            Ok(file) => tracks.push(InboxTrack { file, added_at }),
            Err(error) => {
                tracks.push(InboxTrack {
                    file: FileTrack::unconfirmed(&path),
                    added_at,
                });
                failures.push(FileResult {
                    path,
                    success: false,
                    skipped: false,
                    error: Some(error),
                });
            }
        }
    }
    Ok(InboxRead { tracks, failures })
}

fn register(database: &Database, paths: Vec<String>) -> Vec<FileResult> {
    let mut seen = HashSet::new();
    let existing = database
        .inbox_paths()
        .map(|paths| paths.into_iter().collect::<HashSet<_>>());
    paths
        .into_iter()
        .map(|path| {
            let outcome = (|| {
                let canonical = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
                if !canonical.is_file() {
                    return Err("不是音频文件".to_owned());
                }
                let normalized = canonical.to_string_lossy().into_owned();
                let existing = existing.as_ref().map_err(Clone::clone)?;
                if existing.contains(&normalized) || !seen.insert(normalized.clone()) {
                    return Ok(true);
                }
                if !crate::tracks::discovery::has_supported_extension(&canonical) {
                    return Err("不支持的音频文件".to_owned());
                }
                std::fs::File::open(&canonical).map_err(|error| error.to_string())?;
                database
                    .register_inbox_path(&normalized)
                    .map(|added| !added)
            })();
            FileResult {
                path,
                success: outcome.is_ok(),
                skipped: outcome.as_ref().copied().unwrap_or(false),
                error: outcome.err(),
            }
        })
        .collect()
}

fn collect_directory(path: &Path, files: &mut Vec<String>, failures: &mut Vec<FileResult>) {
    let failure = |path: &Path, error: std::io::Error| FileResult {
        path: path.to_string_lossy().into_owned(),
        success: false,
        skipped: false,
        error: Some(error.to_string()),
    };
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            failures.push(failure(path, error));
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                failures.push(failure(path, error));
                continue;
            }
        };
        let entry_path = entry.path();
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(error) => {
                failures.push(failure(&entry_path, error));
                continue;
            }
        };
        if kind.is_dir() {
            collect_directory(&entry_path, files, failures);
        } else if kind.is_file() && crate::tracks::discovery::has_supported_extension(&entry_path) {
            files.push(entry_path.to_string_lossy().into_owned());
        }
    }
}

fn register_directories(database: &Database, paths: Vec<String>) -> Vec<FileResult> {
    let mut files = Vec::new();
    let mut results = Vec::new();
    for path in paths {
        collect_directory(Path::new(&path), &mut files, &mut results);
    }
    results.extend(register(database, files));
    results
}

fn ingest(database: &Database, paths: Vec<String>) -> Vec<FileResult> {
    paths
        .into_iter()
        .map(|path| {
            let outcome = (|| {
                FileTrack::read(&path)?;
                let mut result = crate::library::import::ImportResult::default();
                crate::library::import::import_track(database, Path::new(&path), &mut result);
                if result.failed != 0 {
                    return Err("扫描失败".to_owned());
                }
                database.remove_inbox_path(&path)
            })();
            FileResult {
                path,
                success: outcome.is_ok(),
                skipped: false,
                error: outcome.err(),
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn read_inbox<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<InboxRead, String> {
    let guard = write.acquire()?;
    crate::database::blocking(app, move |database| {
        let _guard = guard;
        refresh(database)
    })
    .await
}

#[tauri::command]
pub(crate) async fn register_inbox<R: tauri::Runtime>(
    paths: Vec<String>,
    directory: bool,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<FileResult>, String> {
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let database = app.state::<Database>();
        if directory {
            register_directories(&database, paths)
        } else {
            register(&database, paths)
        }
    })
    .await
    .map_err(|error| format!("Inbox 登记失败：{error}"))
}

#[tauri::command]
pub(crate) async fn remove_inbox<R: tauri::Runtime>(
    paths: Vec<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<(), String> {
    let guard = write.acquire()?;
    crate::database::blocking(app, move |database| {
        let _guard = guard;
        for path in paths {
            database.remove_inbox_path(&path)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn ingest_inbox<R: tauri::Runtime>(
    paths: Vec<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<FileResult>, String> {
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        ingest(&app.state::<Database>(), paths)
    })
    .await
    .map_err(|error| format!("Inbox 入库失败：{error}"))
}

#[cfg(test)]
mod tests;
