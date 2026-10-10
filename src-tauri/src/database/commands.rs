use super::{
    AlbumArtistSummary, AlbumSummary, Database, MusicLibraryDirectory, PlaylistReorderError,
    PlaylistSummary, PlaylistTrackSummary, TrackDetails, TrackSummary,
};
use crate::playback::session::{synchronize_removal, RemovalResult, SessionCommand};
use std::path::Path;
use tauri::Manager;

#[tauri::command]
pub fn list_music_library_directories(
    state: tauri::State<'_, Database>,
) -> Result<Vec<MusicLibraryDirectory>, String> {
    state.list_music_library_directories()
}

#[tauri::command]
pub fn add_music_library_directory(
    path: String,
    state: tauri::State<'_, Database>,
) -> Result<bool, String> {
    let canonical_path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("Could not open selected directory: {error}"))?;
    if !canonical_path.is_dir() {
        return Err("The selected path is not a directory".to_owned());
    }
    let path = canonical_path.to_string_lossy().into_owned();
    state.add_music_library_directory(&path)
}

#[tauri::command]
pub fn remove_music_library_directory(
    id: i64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    state.remove_music_library_directory(id)
}

#[tauri::command]
pub fn migrate_track_paths(
    old_path: String,
    new_path: String,
    state: tauri::State<'_, Database>,
) -> Result<usize, String> {
    state.migrate_track_paths(&old_path, &new_path)
}

#[tauri::command]
pub fn list_album_artists(
    state: tauri::State<'_, Database>,
) -> Result<Vec<AlbumArtistSummary>, String> {
    state.list_album_artists()
}

#[tauri::command]
pub fn list_albums(
    album_artist: Option<String>,
    state: tauri::State<'_, Database>,
    settings: tauri::State<'_, crate::settings::SettingsState>,
) -> Result<Vec<AlbumSummary>, String> {
    let settings = settings.get()?;
    state.list_albums(
        album_artist,
        settings.album_sort_by,
        settings.album_sort_order,
    )
}

#[tauri::command]
pub fn list_album_tracks(
    album_artist: Option<String>,
    album: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Vec<TrackSummary>, String> {
    state.list_album_tracks(album_artist, album)
}

#[tauri::command]
pub fn add_track_to_playlist(
    playlist_id: i64,
    track_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    state.add_track_to_playlist(playlist_id, track_id)
}

#[tauri::command]
pub fn create_playlist(name: String, state: tauri::State<'_, Database>) -> Result<i64, String> {
    state.create_playlist(&name)
}

#[tauri::command]
pub fn rename_playlist(
    playlist_id: i64,
    name: String,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    state.rename_playlist(playlist_id, &name)
}

#[tauri::command]
pub fn delete_playlist(playlist_id: i64, state: tauri::State<'_, Database>) -> Result<(), String> {
    state.delete_playlist(playlist_id)
}

#[tauri::command]
pub fn list_playlists(state: tauri::State<'_, Database>) -> Result<Vec<PlaylistSummary>, String> {
    state.list_playlists()
}

#[tauri::command]
pub fn list_playlist_tracks(
    playlist_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Vec<PlaylistTrackSummary>, String> {
    state.list_playlist_tracks(playlist_id)
}

#[tauri::command]
pub fn remove_playlist_items(
    playlist_id: i64,
    playlist_item_ids: Vec<i64>,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    state.remove_playlist_items(playlist_id, playlist_item_ids)
}

#[tauri::command]
pub fn reorder_playlist_items(
    playlist_id: i64,
    ordered_playlist_item_ids: Vec<i64>,
    state: tauri::State<'_, Database>,
) -> Result<(), PlaylistReorderError> {
    state.reorder_playlist_items(playlist_id, ordered_playlist_item_ids)
}

#[tauri::command]
pub async fn remove_track_from_library<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<RemovalResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Database>()
            .remove_track_from_library(track_id)?;
        Ok(synchronize_removal(
            &app,
            SessionCommand::RemoveTrack { track_id },
        ))
    })
    .await
    .map_err(|error| format!("Could not remove library track: {error}"))?
}

#[tauri::command]
pub fn list_skipped_track_ids(state: tauri::State<'_, Database>) -> Result<Vec<i64>, String> {
    state.list_skipped_track_ids()
}

#[tauri::command]
pub fn set_tracks_skipped(
    track_ids: Vec<i64>,
    skipped: bool,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    state.set_tracks_skipped(&track_ids, skipped)
}

#[tauri::command]
pub fn get_track(
    track_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Option<TrackDetails>, String> {
    state.get_track(track_id)
}
