mod database;
pub mod lyrics;
mod playback;
mod scan;
mod settings;
#[cfg(windows)]
mod system_media;
mod tray;

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
            app.manage(settings::SettingsState::load(
                app_data_dir.join("settings.json"),
            )?);
            tray::initialize(app.handle())?;
            #[cfg(windows)]
            if let Err(error) = system_media::initialize(app.handle()) {
                eprintln!("Could not initialize Windows media controls: {error}");
            }
            Ok(())
        })
        .on_window_event(tray::on_window_event)
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
            settings::get_settings,
            settings::save_settings,
            database::commands::list_music_library_directories,
            database::commands::add_music_library_directory,
            database::commands::remove_music_library_directory,
            scan::scan_music_library,
            lyrics::get_track_lyrics,
            database::commands::list_album_artists,
            database::commands::list_albums,
            database::commands::get_album_artwork,
            database::commands::list_album_tracks,
            database::commands::remove_track_from_library,
            database::commands::create_playlist,
            database::commands::rename_playlist,
            database::commands::delete_playlist,
            database::commands::add_track_to_playlist,
            database::commands::list_playlists,
            database::commands::list_playlist_tracks,
            database::commands::remove_playlist_items,
            database::commands::reorder_playlist_items,
            database::commands::get_track,
            database::commands::get_track_artwork,
            playback::play_track,
            playback::prepare_next_track,
            playback::set_volume,
            playback::pause,
            playback::resume,
            playback::stop_playback,
            playback::seek_to,
            playback::playback_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
