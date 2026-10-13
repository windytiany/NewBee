use super::model::{
    AlbumSummary, ArtistSummary, LibraryGroup, LibraryGrouping, MusicLibraryDirectory,
};
use crate::database::blocking;
use crate::playback::session::RemovalResult;
use crate::tracks::model::TrackSummary;
use std::path::Path;
use tauri::Manager;

#[tauri::command]
pub async fn list_music_library_directories<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<MusicLibraryDirectory>, String> {
    blocking(app, |database| database.list_music_library_directories()).await
}

#[tauri::command]
pub async fn add_music_library_directory<R: tauri::Runtime>(
    path: String,
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    blocking(app, move |database| {
        let canonical_path = Path::new(&path)
            .canonicalize()
            .map_err(|error| format!("Could not open selected directory: {error}"))?;
        if !canonical_path.is_dir() {
            return Err("The selected path is not a directory".to_owned());
        }
        let path = canonical_path.to_string_lossy().into_owned();
        database.add_music_library_directory(&path)
    })
    .await
}

#[tauri::command]
pub async fn remove_music_library_directory<R: tauri::Runtime>(
    id: i64,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    blocking(app, move |database| {
        database.remove_music_library_directory(id)
    })
    .await
}

#[tauri::command]
pub async fn migrate_library_paths<R: tauri::Runtime>(
    old_path: String,
    new_path: String,
    app: tauri::AppHandle<R>,
) -> Result<usize, String> {
    let guard = app.state::<crate::locking::write::WriteState>().acquire()?;
    blocking(app, move |database| {
        let _guard = guard;
        database.migrate_library_paths(&old_path, &new_path)
    })
    .await
}

#[tauri::command]
pub async fn list_artists<R: tauri::Runtime>(
    grouping: LibraryGrouping,
    app: tauri::AppHandle<R>,
) -> Result<Vec<ArtistSummary>, String> {
    blocking(app, move |database| database.list_artists(grouping)).await
}

#[tauri::command]
pub async fn list_albums<R: tauri::Runtime>(
    group: LibraryGroup,
    app: tauri::AppHandle<R>,
) -> Result<Vec<AlbumSummary>, String> {
    let settings = app.state::<crate::settings::SettingsState>().get()?;
    blocking(app, move |database| {
        database.list_albums(group, settings.album_sort_by, settings.album_sort_order)
    })
    .await
}

#[tauri::command]
pub async fn list_external_track_ids<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<i64>, String> {
    blocking(app, move |database| database.external_track_ids(&track_ids)).await
}

#[tauri::command]
pub async fn list_album_tracks<R: tauri::Runtime>(
    album_artist: Option<String>,
    album: Option<String>,
    group: Option<LibraryGroup>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<TrackSummary>, String> {
    blocking(app, move |database| {
        database.list_album_tracks(album_artist, album, group)
    })
    .await
}

#[tauri::command]
pub async fn remove_track_from_library<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<RemovalResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<crate::database::Database>()
            .remove_track_from_library(track_id)?;
        Ok(RemovalResult::Removed)
    })
    .await
    .map_err(|error| format!("Could not remove library track: {error}"))?
}
