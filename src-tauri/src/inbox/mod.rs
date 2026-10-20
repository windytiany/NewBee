use crate::{database::Database, locking::WriteState, tracks::model::TrackDetails};
use serde::Serialize;
use std::path::Path;
use tauri::{Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileResult {
    track_id: Option<i64>,
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
    track: TrackDetails,
    added_at: i64,
}

fn refresh(database: &Database) -> Result<InboxRead, String> {
    let mut tracks = Vec::new();
    for (id, added_at) in database.inbox_entries()? {
        let track = database
            .get_track(id)?
            .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
        tracks.push(InboxTrack { track, added_at });
    }
    Ok(InboxRead {
        tracks,
        failures: Vec::new(),
    })
}

pub(crate) fn register(database: &Database, paths: Vec<String>) -> Vec<FileResult> {
    paths
        .into_iter()
        .map(|path| {
            let outcome = (|| {
                let canonical = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
                if !crate::tracks::has_supported_extension(&canonical) {
                    return Err("不支持的音频文件".to_owned());
                }
                let snapshot = crate::tracks::inspect(database, &canonical)?;
                database.save_inbox_snapshot(&snapshot)
            })();
            if let Err(error) = &outcome {
                log::warn!(
                    "Inbox registration '{}' failed during scan/publication: {error}",
                    path
                );
            }
            FileResult {
                track_id: outcome.as_ref().ok().copied(),
                path,
                success: outcome.is_ok(),
                skipped: false,
                error: outcome.err(),
            }
        })
        .collect()
}

fn collect_directory(path: &Path, files: &mut Vec<String>, failures: &mut Vec<FileResult>) {
    let failure = |path: &Path, error: std::io::Error| FileResult {
        track_id: None,
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
        } else if kind.is_file() && crate::tracks::has_supported_extension(&entry_path) {
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

fn ingest(database: &Database, track_ids: Vec<i64>) -> Vec<FileResult> {
    track_ids
        .into_iter()
        .map(|id| {
            let mut path = String::new();
            let outcome = (|| {
                if !database
                    .inbox_entries()?
                    .iter()
                    .any(|(candidate, _)| *candidate == id)
                {
                    return Err("曲目不在 Inbox 中".to_owned());
                }
                let track = database
                    .get_track(id)?
                    .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
                path = track.path;
                let snapshot = crate::tracks::inspect(database, Path::new(&path))?;
                database.import_snapshot(&snapshot).map(|_| ())
            })();
            if let Err(error) = &outcome {
                log::warn!(
                    "Inbox ingest {id} '{}' failed during scan/publication: {error}",
                    path
                );
            }
            FileResult {
                track_id: Some(id),
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
) -> Result<InboxRead, String> {
    crate::database::blocking(app, refresh).await
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
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<(), String> {
    let guard = write.acquire()?;
    crate::database::blocking(app, move |database| {
        let _guard = guard;
        for id in track_ids {
            database.remove_inbox_track(id)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn ingest_inbox<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<FileResult>, String> {
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        ingest(&app.state::<Database>(), track_ids)
    })
    .await
    .map_err(|error| format!("Inbox 入库失败：{error}"))
}

#[cfg(test)]
mod tests;
