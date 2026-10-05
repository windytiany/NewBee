use super::CoverData;
use crate::{
    database::{write::WriteState, Database, EmbeddedArtwork},
    metadata::{
        files,
        model::{normalize_changes, validate_track_ids, MetadataChange, MetadataField},
        MetadataSaveResult,
    },
};
use serde::Deserialize;
use std::path::Path;
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
pub(crate) async fn save_album_tags(
    mut patches: Vec<TrackPatch>,
    cover: Option<CoverData>,
    on_progress: Channel<MetadataSaveResult>,
    app: tauri::AppHandle,
    write: State<'_, WriteState>,
) -> Result<Vec<MetadataSaveResult>, String> {
    validate_patches(&mut patches, cover.as_ref())?;
    let picture = cover
        .as_ref()
        .map(|cover| files::cover_picture(&cover.data))
        .transpose()?;
    // Derive MIME from bytes rather than trusting the frontend.
    let artwork = picture.as_ref().map(|picture| EmbeddedArtwork {
        mime_type: picture
            .mime_type()
            .map(ToString::to_string)
            .unwrap_or_default(),
        image: picture.data().to_vec(),
    });
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let database = app.state::<Database>();
        let results = patches
            .iter()
            .map(|patch| {
                let result = save_patch(&database, patch, picture.as_ref(), artwork.as_ref());
                if let Err(error) = on_progress.send(result.clone()) {
                    eprintln!("Could not report album metadata progress: {error}");
                }
                result
            })
            .collect();
        Ok(results)
    })
    .await
    .map_err(|error| format!("保存标签任务失败：{error}"))?
}
fn save_patch(
    database: &Database,
    patch: &TrackPatch,
    picture: Option<&lofty::picture::Picture>,
    artwork: Option<&EmbeddedArtwork>,
) -> MetadataSaveResult {
    let mut result = MetadataSaveResult {
        track_id: patch.track_id,
        path: String::new(),
        file_written: false,
        database_updated: false,
        error: None,
    };
    let outcome = (|| {
        let track = database
            .get_track(patch.track_id)?
            .ok_or_else(|| "曲目已不在数据库中".to_owned())?;
        result.path = track.path().to_owned();
        files::write_file_with_cover(
            Path::new(track.path()),
            &patch.changes,
            if patch.write_cover { picture } else { None },
        )?;
        result.file_written = true;
        database
            .update_metadata_and_cover(
                patch.track_id,
                &patch.changes,
                if patch.write_cover { artwork } else { None },
            )
            .map_err(|error| format!("文件已写入，但数据库同步失败，请重试或重新扫描：{error}"))?;
        result.database_updated = true;
        Ok::<_, String>(())
    })();
    result.error = outcome.err();
    result
}
#[cfg(test)]
#[path = "tests/save.rs"]
mod tests;
