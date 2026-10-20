use crate::database::blocking;

#[tauri::command]
pub async fn list_skipped_track_ids<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<i64>, String> {
    blocking(app, |database| database.list_skipped_track_ids()).await
}

#[tauri::command]
pub async fn set_tracks_skipped<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    skipped: bool,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    blocking(app, move |database| {
        database.set_tracks_skipped(&track_ids, skipped)
    })
    .await
}
