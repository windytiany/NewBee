mod database;
mod playback;
mod scan;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(playback::PlaybackState::default())
        .manage(scan::ScanState::default())
        .setup(|app| {
            use tauri::Manager;

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join("music-library.sqlite3");
            app.manage(database::Database::open(database_path)?);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            database::list_music_library_directories,
            database::add_music_library_directory,
            database::remove_music_library_directory,
            scan::scan_music_library,
            database::list_album_artists,
            database::list_albums,
            database::list_album_tracks,
            database::create_playlist,
            database::list_playlists,
            database::list_playlist_tracks,
            database::get_track,
            database::get_track_artwork,
            playback::play,
            playback::set_volume,
            playback::pause,
            playback::resume,
            playback::seek_to,
            playback::playback_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
