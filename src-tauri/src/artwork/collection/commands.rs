use crate::database::Database;
use serde::Serialize;
use tauri::{ipc::Response, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Description {
    pub(crate) track_id: i64,
    pub(crate) pictures: Vec<PictureDescription>,
    pub(crate) display_index: Option<usize>,
    pub(crate) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PictureDescription {
    pub(crate) artwork_id: i64,
    pub(crate) content_id: String,
    pub(crate) mime_type: String,
    pub(crate) byte_length: i64,
    pub(crate) picture_type: u8,
    pub(crate) source: String,
    pub(crate) path: String,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_track_artwork_collections<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<Description>, String> {
    let track_ids = crate::metadata::model::validate_track_ids(&track_ids)?;
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        database.describe_artwork_collections(&track_ids)
    })
    .await
    .map_err(|error| format!("读取图片集合失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_artwork_picture<R: tauri::Runtime>(
    artwork_id: i64,
    size: Option<u32>,
    app: tauri::AppHandle<R>,
) -> Result<Response, String> {
    super::super::request::validate_size(size)?;
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        database
            .artwork_picture_bytes(artwork_id, size, |data, size| {
                super::super::thumbnail(&database, data, size)
            })
            .map(Response::new)
    })
    .await
    .map_err(|error| format!("读取图片内容失败：{error}"))?
}
