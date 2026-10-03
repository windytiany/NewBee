mod database;
mod ingest;
pub mod lyrics;
mod playback;
mod settings;
#[cfg(windows)]
mod system_media;
mod tray;
mod window_lifecycle;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(playback::PlaybackState::default())
        .manage(ingest::IngestState::default())
        .setup(|app| {
            use tauri::Manager;

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join("music-library.sqlite3");
            app.manage(database::Database::open(database_path)?);
            app.manage(settings::SettingsState::load(
                app_data_dir.join("settings.json"),
            )?);
            window_lifecycle::initialize(app.handle());
            tray::initialize(app.handle())?;
            #[cfg(windows)]
            if let Err(error) = system_media::initialize(app.handle()) {
                eprintln!("Could not initialize Windows media controls: {error}");
            }
            Ok(())
        })
        .on_window_event(window_lifecycle::on_window_event)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_lifecycle::STATE_FLAGS)
                .skip_initial_state("main")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            window_lifecycle::show_main_window,
            settings::get_settings,
            settings::save_settings,
            database::commands::list_music_library_directories,
            database::commands::add_music_library_directory,
            database::commands::remove_music_library_directory,
            database::commands::migrate_track_paths,
            ingest::directory::scan_music_library,
            ingest::supported_audio_extensions,
            ingest::files::import_music_files,
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
            database::commands::list_skipped_track_ids,
            database::commands::set_tracks_skipped,
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
            playback::playback_spectrum,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
