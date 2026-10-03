mod files;
pub(crate) mod model;
#[cfg(test)]
mod tests;

use crate::database::{Database, TrackDetails};
use crate::ingest::IngestState;
use model::{normalize_changes, validate_track_ids, MetadataChange, MetadataField};
use serde::Serialize;
use std::path::Path;
use tauri::{ipc::Channel, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditableTrack {
    track: TrackDetails,
    writable_fields: Vec<MetadataField>,
    issue: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetadataSaveResult {
    track_id: i64,
    path: String,
    file_written: bool,
    database_updated: bool,
    error: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_editable_tracks(
    track_ids: Vec<i64>,
    app: tauri::AppHandle,
) -> Result<Vec<EditableTrack>, String> {
    let track_ids = validate_track_ids(&track_ids)?;
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        track_ids
            .into_iter()
            .map(|id| {
                let track = database
                    .get_track(id)?
                    .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
                let (writable_fields, issue) = match files::inspect_file(Path::new(track.path())) {
                    Ok(fields) if fields.is_empty() => {
                        (fields, Some("此文件格式不支持标签写入".to_owned()))
                    }
                    Ok(fields) => (fields, None),
                    Err(error) => (Vec::new(), Some(error)),
                };
                Ok(EditableTrack {
                    track,
                    writable_fields,
                    issue,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| format!("读取编辑信息失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn save_track_metadata(
    track_ids: Vec<i64>,
    mut changes: Vec<MetadataChange>,
    on_progress: Channel<MetadataSaveResult>,
    app: tauri::AppHandle,
    ingest: State<'_, IngestState>,
) -> Result<Vec<MetadataSaveResult>, String> {
    let track_ids = validate_track_ids(&track_ids)?;
    normalize_changes(&mut changes)?;
    let guard = ingest.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let database = app.state::<Database>();
        // Validate combinations for every readable target before modifying the first file.
        // Missing/unreadable files are reported individually, not used to block other targets.
        for id in &track_ids {
            if let Some(track) = database.get_track(*id)? {
                if files::inspect_file(Path::new(track.path())).is_ok() {
                    files::validate_file(Path::new(track.path()), &changes)
                        .map_err(|error| format!("{}：{error}", track.path()))?;
                }
            }
        }
        let results = track_ids
            .into_iter()
            .map(|id| {
                let result = save_track(&database, id, &changes);
                if let Err(error) = on_progress.send(result.clone()) {
                    eprintln!("Could not report metadata progress: {error}");
                }
                result
            })
            .collect();
        Ok(results)
    })
    .await
    .map_err(|error| format!("保存标签任务失败：{error}"))?
}

fn save_track(
    database: &Database,
    track_id: i64,
    changes: &[MetadataChange],
) -> MetadataSaveResult {
    let mut result = MetadataSaveResult {
        track_id,
        path: String::new(),
        file_written: false,
        database_updated: false,
        error: None,
    };
    let track = match database.get_track(track_id) {
        Ok(Some(track)) => track,
        Ok(None) => {
            result.error = Some(format!("曲目 {track_id} 已不在数据库中"));
            return result;
        }
        Err(error) => {
            result.error = Some(error);
            return result;
        }
    };
    result.path = track.path().to_owned();
    if let Err(error) = files::write_file(Path::new(track.path()), changes) {
        result.error = Some(error);
        return result;
    }
    result.file_written = true;
    match database.update_track_metadata(track_id, changes) {
        Ok(()) => result.database_updated = true,
        Err(error) => {
            result.error = Some(format!(
                "文件已写入，但数据库同步失败。请再次保存或重新扫描：{error}"
            ))
        }
    }
    result
}
