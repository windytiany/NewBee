pub(crate) mod files;
pub(crate) mod model;
pub(crate) mod releases;
#[cfg(test)]
mod tests;

use crate::database::{write::WriteState, Database, TrackDetails};
use model::{
    normalize_changes, validate_track_ids, LyricsMarkAction, MetadataChange, MetadataField,
};
use serde::Serialize;
use std::path::Path;
use tauri::{ipc::Channel, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditableTrack {
    track: TrackDetails,
    lyrics: Option<String>,
    no_lyrics: bool,
    writable_fields: Vec<MetadataField>,
    issue: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetadataSaveResult {
    pub(crate) track_id: i64,
    pub(crate) path: String,
    pub(crate) file_written: bool,
    pub(crate) database_updated: bool,
    pub(crate) error: Option<String>,
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
                let snapshot = database.get_lyrics(id)?;
                let metadata = files::inspect_file(Path::new(track.path()));
                let (writable_fields, issue) = match metadata {
                    Ok(metadata) => (metadata.writable_fields, metadata.issue),
                    Err(error) => (Vec::new(), Some(error)),
                };
                Ok(EditableTrack {
                    track,
                    lyrics: snapshot.text,
                    no_lyrics: snapshot.no_lyrics,
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
    lyrics_action: LyricsMarkAction,
    on_progress: Channel<MetadataSaveResult>,
    app: tauri::AppHandle,
    write: State<'_, WriteState>,
) -> Result<Vec<MetadataSaveResult>, String> {
    let track_ids = validate_track_ids(&track_ids)?;
    if !changes.is_empty() || lyrics_action == LyricsMarkAction::Keep {
        normalize_changes(&mut changes)?;
    }
    if track_ids.len() != 1
        && changes
            .iter()
            .any(|change| change.field == MetadataField::Lyrics)
    {
        return Err("歌词仅支持单曲编辑".to_owned());
    }
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let database = app.state::<Database>();
        // Validate combinations for every readable target before modifying the first file.
        // Missing/unreadable files are reported individually, not used to block other targets.
        for id in track_ids.iter().filter(|_| !changes.is_empty()) {
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
                let result = save_track_with_lyrics_action(&database, id, &changes, lyrics_action);
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

pub(crate) fn save_track(
    database: &Database,
    track_id: i64,
    changes: &[MetadataChange],
) -> MetadataSaveResult {
    save_track_with_lyrics_action(database, track_id, changes, LyricsMarkAction::Keep)
}

pub(crate) fn save_track_with_lyrics_action(
    database: &Database,
    track_id: i64,
    changes: &[MetadataChange],
    action: LyricsMarkAction,
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
    let mut effective_changes = changes.to_vec();
    if action == LyricsMarkAction::Mark {
        effective_changes.retain(|change| change.field != MetadataField::Lyrics);
        let snapshot = match database.get_lyrics(track_id) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                result.error = Some(error);
                return result;
            }
        };
        if snapshot.text.is_some() {
            effective_changes.push(MetadataChange {
                field: MetadataField::Lyrics,
                value: None,
            });
        }
    }
    if !effective_changes.is_empty() {
        if let Err(error) = files::write_file(Path::new(track.path()), &effective_changes) {
            result.error = Some(error);
            return result;
        }
        result.file_written = true;
    }
    let update = if action == LyricsMarkAction::Keep {
        database.update_track_metadata(track_id, &effective_changes)
    } else {
        database.update_metadata_cover_and_lyrics(track_id, &effective_changes, None, action)
    };
    match update {
        Ok(()) => result.database_updated = true,
        Err(error) => {
            result.error = Some(if result.file_written {
                format!("文件已写入，但数据库同步失败。请再次保存或重新扫描：{error}")
            } else {
                format!("数据库更新失败：{error}")
            })
        }
    }
    result
}
