use super::model::{
    PlaylistAppendResult, PlaylistReorderError, PlaylistSummary, PlaylistTrackSummary,
};
use crate::database::blocking;

#[tauri::command]
pub async fn append_playlist_tracks<R: tauri::Runtime>(
    playlist_id: i64,
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<PlaylistAppendResult>, String> {
    blocking(app, move |database| {
        database.append_playlist_tracks(playlist_id, track_ids)
    })
    .await
}

#[tauri::command]
pub async fn create_playlist<R: tauri::Runtime>(
    name: String,
    app: tauri::AppHandle<R>,
) -> Result<i64, String> {
    blocking(app, move |database| database.create_playlist(&name)).await
}

#[tauri::command]
pub async fn rename_playlist<R: tauri::Runtime>(
    playlist_id: i64,
    name: String,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    blocking(app, move |database| {
        database.rename_playlist(playlist_id, &name)
    })
    .await
}

#[tauri::command]
pub async fn delete_playlist<R: tauri::Runtime>(
    playlist_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    blocking(app, move |database| database.delete_playlist(playlist_id)).await
}

#[tauri::command]
pub async fn list_playlists<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<PlaylistSummary>, String> {
    blocking(app, |database| database.list_playlists()).await
}

#[tauri::command]
pub async fn list_playlist_tracks<R: tauri::Runtime>(
    playlist_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<Vec<PlaylistTrackSummary>, String> {
    blocking(app, move |database| {
        database.list_playlist_tracks(playlist_id)
    })
    .await
}

#[tauri::command]
pub async fn remove_playlist_items<R: tauri::Runtime>(
    playlist_id: i64,
    playlist_item_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    blocking(app, move |database| {
        database.remove_playlist_items(playlist_id, playlist_item_ids)
    })
    .await
}

#[tauri::command]
pub async fn reorder_playlist_items<R: tauri::Runtime>(
    playlist_id: i64,
    ordered_playlist_item_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<(), PlaylistReorderError> {
    blocking(app, move |database| {
        database.reorder_playlist_items(playlist_id, ordered_playlist_item_ids)
    })
    .await
}
