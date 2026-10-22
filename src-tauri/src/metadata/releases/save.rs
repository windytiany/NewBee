use super::CoverData;
use crate::{
    database::Database,
    locking::WriteState,
    metadata::{
        files,
        model::{
            normalize_changes, validate_track_ids, LyricsMarkAction, MetadataChange, MetadataField,
        },
        save::{save_track, CoverUpdate},
        MetadataSaveResult,
    },
};
use serde::Deserialize;
use tauri::{ipc::Channel, Manager, State};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrackPatch {
    track_id: i64,
    changes: Vec<MetadataChange>,
    write_cover: bool,
}

fn validate_patches(patches: &mut [TrackPatch], cover: Option<&CoverData>) -> Result<(), String> {
    let ids: Vec<_> = patches.iter().map(|patch| patch.track_id).collect();
    if validate_track_ids(&ids)?.len() != ids.len() {
        return Err("曲目不能重复".to_owned());
    }
    for patch in patches {
        if patch.write_cover && cover.is_none() {
            return Err("封面尚未下载，不能写入".to_owned());
        }
        if patch.changes.is_empty() {
            if !patch.write_cover {
                return Err("曲目没有改动".to_owned());
            }
        } else {
            normalize_changes(&mut patch.changes)?;
            patch
                .changes
                .retain(|change| change.value.is_some() || !change.values.is_empty());
        }
        if patch
            .changes
            .iter()
            .any(|change| change.field == MetadataField::Lyrics)
        {
            return Err("专辑匹配不支持写入歌词".to_owned());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn save_album_tags<R: tauri::Runtime>(
    mut patches: Vec<TrackPatch>,
    cover: Option<CoverData>,
    on_progress: Channel<MetadataSaveResult>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<MetadataSaveResult>, String> {
    validate_patches(&mut patches, cover.as_ref())?;
    crate::tasks::validate(
        &app.state::<Database>(),
        &patches
            .iter()
            .map(|patch| patch.track_id)
            .collect::<Vec<_>>(),
        operation_id.as_deref(),
        &[],
    )?;
    let guard = write.acquire_task(operation_id.as_deref()).await?;
    crate::tasks::validate(
        &app.state::<Database>(),
        &patches
            .iter()
            .map(|patch| patch.track_id)
            .collect::<Vec<_>>(),
        operation_id.as_deref(),
        &[],
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::tasks::with_operation(operation_id.clone(), || {
            let _guard = guard;
            let cover = cover
                .as_ref()
                .map(|cover| files::cover_picture(&cover.data).map(CoverUpdate::new))
                .transpose()?;
            let database = app.state::<Database>();
            let results = patches
                .iter()
                .take_while(|_| !crate::tasks::cancelled())
                .map(|patch| {
                    let result = save_track(
                        &database,
                        patch.track_id,
                        &patch.changes,
                        LyricsMarkAction::Keep,
                        if patch.write_cover {
                            cover.as_ref()
                        } else {
                            None
                        },
                    );
                    if let Err(error) = on_progress.send(result.clone()) {
                        log::warn!("Could not report album metadata progress: {error}");
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
