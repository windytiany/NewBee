pub(crate) mod files;
pub(crate) mod model;
pub(crate) mod releases;
pub(crate) mod replaygain;
pub(crate) mod revision;
pub(crate) mod save;
#[cfg(test)]
mod tests;

use crate::database::Database;
use crate::locking::WriteState;
use crate::tracks::model::TrackDetails;
use model::{normalize_changes, validate_track_ids, LyricsMarkAction, MetadataField};
use serde::Serialize;
use tauri::{ipc::Channel, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditableTrack {
    track: TrackDetails,
    lyrics: Option<String>,
    no_lyrics: bool,
    writable_fields: Vec<MetadataField>,
    values: std::collections::HashMap<MetadataField, String>,
    issue: Option<String>,
    revision: Option<String>,
    write_pending: bool,
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
pub(crate) async fn get_editable_tracks<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<EditableTrack>, String> {
    let track_ids = validate_track_ids(&track_ids)?;
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        track_ids
            .into_iter()
            .map(|id| {
                let write_pending = crate::tasks::validate(&database, &[id], None, &[]).is_err();
                let revision = revision::read(&database, id).ok();
                let track = database
                    .get_track(id)?
                    .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
                let snapshot = database.get_lyrics(id)?;
                let metadata = database.get_editing_snapshot(id)?;
                let writable_fields = metadata.writable_fields;
                let issue = metadata.issue;
                Ok(EditableTrack {
                    revision,
                    write_pending,
                    track,
                    lyrics: snapshot.text,
                    no_lyrics: snapshot.no_lyrics,
                    writable_fields,
                    values: metadata.values,
                    issue,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| format!("读取编辑信息失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn save_track_metadata<R: tauri::Runtime>(
    request: model::MetadataSaveRequest,
    on_progress: Channel<MetadataSaveResult>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<MetadataSaveResult>, String> {
    let model::MetadataSaveRequest {
        track_ids,
        mut changes,
        lyrics_action,
        artwork_drafts,
    } = request;
    let track_ids = validate_track_ids(&track_ids)?;
    if changes
        .iter()
        .any(|change| MetadataField::IDENTIFIERS.contains(&change.field))
    {
        return Err("标识仅支持在线导入".to_owned());
    }
    if !changes.is_empty() || (lyrics_action == LyricsMarkAction::Keep && artwork_drafts.is_empty())
    {
        normalize_changes(&mut changes)?;
    }
    if track_ids.len() != 1
        && changes
            .iter()
            .any(|change| change.field == MetadataField::Lyrics)
    {
        return Err("歌词仅支持单曲编辑".to_owned());
    }
    crate::tasks::validate(
        &app.state::<Database>(),
        &track_ids,
        operation_id.as_deref(),
        &[],
    )?;
    let guard = write.acquire_task(operation_id.as_deref()).await?;
    crate::tasks::validate(
        &app.state::<Database>(),
        &track_ids,
        operation_id.as_deref(),
        &[],
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::tasks::with_operation(operation_id.clone(), || {
            let _guard = guard;
            let database = app.state::<Database>();
            let mut drafts = std::collections::HashMap::new();
            for draft in artwork_drafts {
                let id = draft.track_id;
                if !track_ids.contains(&id) || drafts.insert(id, draft).is_some() {
                    return Err("图片草稿包含重复或非目标曲目".into());
                }
            }
            let results = track_ids
                .into_iter()
                .take_while(|_| !crate::tasks::cancelled())
                .map(|id| {
                    let prepared = drafts
                        .remove(&id)
                        .map(|draft| crate::artwork::track::editing::prepare(&database, draft))
                        .transpose();
                    let result = match prepared {
                        Ok(prepared) => save::save_track_collection(
                            &database,
                            id,
                            &changes,
                            lyrics_action,
                            prepared.as_ref(),
                        ),
                        Err(error) => {
                            log::warn!("event=metadata_prepare_failed trackId={id} error={error}");
                            MetadataSaveResult {
                                track_id: id,
                                path: database
                                    .get_track(id)
                                    .ok()
                                    .flatten()
                                    .map(|track| track.path().to_owned())
                                    .unwrap_or_default(),
                                file_written: false,
                                database_updated: false,
                                error: Some(error),
                            }
                        }
                    };
                    if let Err(error) = on_progress.send(result.clone()) {
                        log::warn!("Could not report metadata progress: {error}");
                    }
                    result
                })
                .collect();
            Ok(results)
        })
    })
    .await
    .map_err(|error| format!("保存标签任务失败：{error}"))?
}
