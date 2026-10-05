mod database;
mod import;
pub mod lyrics;
mod metadata;
mod playback;
mod settings;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(playback::PlaybackState::default())
        .manage(database::write::WriteState::default())
        .manage(lyrics::download::LyricsDownloadState::default())
        .setup(|app| {
            use tauri::Manager;

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join("music-library.sqlite3");
            app.manage(database::Database::open(database_path)?);
            app.manage(settings::SettingsState::load(
                app_data_dir.join("settings.json"),
            )?);
            window::initialize(app.handle());
            window::tray::initialize(app.handle())?;
            #[cfg(windows)]
            if let Err(error) = playback::media::initialize(app.handle()) {
                eprintln!("Could not initialize Windows media controls: {error}");
            }
            Ok(())
        })
        .on_window_event(window::on_window_event)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window::STATE_FLAGS)
                .skip_initial_state("main")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            window::show_main_window,
            settings::get_settings,
            settings::save_settings,
            database::commands::list_music_library_directories,
            database::commands::add_music_library_directory,
            database::commands::remove_music_library_directory,
            database::commands::migrate_track_paths,
            import::directory::scan_music_library,
            import::supported_audio_extensions,
            import::files::import_music_files,
            lyrics::local::get_track_lyrics,
            lyrics::download::search_lyrics_candidates,
            lyrics::download::get_candidate_lyrics,
            lyrics::download::find_track_lyrics,
            lyrics::download::begin_lyrics_download,
            lyrics::download::fetch_batch_lyrics,
            lyrics::download::write_batch_lyrics,
            lyrics::download::cancel_lyrics_download,
            lyrics::download::finish_lyrics_download,
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
            metadata::get_editable_tracks,
            metadata::save_track_metadata,
            metadata::releases::search_album_releases,
            metadata::releases::get_album_release,
            metadata::releases::get_release_covers,
            metadata::releases::get_release_cover,
            metadata::releases::save::save_album_tags,
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
