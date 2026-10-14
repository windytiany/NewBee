use super::editing::{prepare, TrackDraft};
use crate::database::Database;
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WritePlan {
    track_id: i64,
    file_write_required: bool,
    error: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_artwork_write_plan<R: tauri::Runtime>(
    artwork_drafts: Vec<TrackDraft>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<WritePlan>, String> {
    let mut seen = std::collections::HashSet::new();
    if artwork_drafts
        .iter()
        .any(|draft| draft.track_id <= 0 || !seen.insert(draft.track_id))
    {
        return Err("图片草稿包含无效或重复曲目".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        artwork_drafts
            .into_iter()
            .map(|draft| {
                let id = draft.track_id;
                let result = (|| {
                    let track = database
                        .get_track(id)?
                        .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
                    prepare(&database, draft)?
                        .requires_file_write(std::path::Path::new(track.path()))
                })();
                match result {
                    Ok(required) => WritePlan {
                        track_id: id,
                        file_write_required: required,
                        error: None,
                    },
                    Err(error) => {
                        log::warn!("event=artwork_plan_failed trackId={id} error={error}");
                        WritePlan {
                            track_id: id,
                            file_write_required: false,
                            error: Some(error),
                        }
                    }
                }
            })
            .collect()
    })
    .await
    .map_err(|error| format!("准备图片写入计划失败：{error}"))
}
