mod artwork;
mod backup;
mod data;
mod database;
mod library;
mod logging;
pub mod lyrics;
mod metadata;
mod playback;
mod playlist;
mod settings;
mod shortcuts;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(playback::PlaybackState::default())
        .manage(data::write::WriteState::default())
        .manage(backup::BackupState::default())
        .manage(lyrics::batch::LyricsBatchState::default())
        .setup(|app| {
            use tauri::Manager;

            logging::initialize(app.handle());
            let mut stage = "data_directory";
            let setup = (|| {
                let app_data_dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&app_data_dir)?;
                stage = "restore";
                app.manage(backup::lock_data_directory(&app_data_dir)?);
                let restoring = match backup::apply_pending_restore(&app_data_dir) {
                    Ok(restored) => restored,
                    Err(error) => {
                        backup::abort_pending_restore(&app_data_dir)?;
                        log::error!("event=backup_restore_failed error={error}");
                        app.state::<backup::BackupState>()
                            .report_restore_error(error)?;
                        false
                    }
                };
                stage = "database";
                let database_path = app_data_dir.join("music-library.sqlite3");
                let cache_directory = app.path().app_cache_dir()?.join("artwork");
                app.manage(database::Database::open_with_cache(
                    database_path,
                    &cache_directory,
                )?);
                stage = "settings";
                app.manage(settings::SettingsState::load(
                    app_data_dir.join("settings.json"),
                )?);
                stage = "playback_statistics";
                playback::statistics::initialize(app.handle());
                stage = "playback_session";
                playback::session::initialize(
                    app.handle(),
                    app_data_dir.join("playback-session.json"),
                );
                stage = "window";
                window::initialize(app.handle());
                window::tray::initialize(app.handle())?;
                stage = "shortcuts";
                shortcuts::initialize(app.handle(), restoring);
                #[cfg(windows)]
                if let Err(error) = playback::media::initialize(app.handle()) {
                    log::warn!("Could not initialize Windows media controls: {error}");
                }
                Ok::<_, Box<dyn std::error::Error>>(())
            })();
            if let Err(error) = &setup {
                log::error!("event=application_setup_failed stage={stage} error={error}");
            }
            setup
        })
        .on_window_event(window::on_window_event)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcuts::handle_global_event)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window::STATE_FLAGS)
                .skip_initial_state("main")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            logging::open_logs_directory,
            logging::set_detailed_logging,
            window::show_main_window,
            settings::get_settings,
            settings::save_settings,
            backup::export_backup,
            backup::inspect_backup,
            backup::restore_backup,
            backup::open_backups_directory,
            backup::get_restored_interface_state,
            backup::get_backup_restore_error,
            backup::acknowledge_interface_restore,
            shortcuts::run_shortcut,
            shortcuts::set_shortcuts_suspended,
            shortcuts::get_shortcuts_error,
            library::commands::list_music_library_directories,
            library::commands::add_music_library_directory,
            library::commands::remove_music_library_directory,
            library::commands::migrate_library_paths,
            library::import::directory::scan_music_library,
            library::import::supported_audio_extensions,
            library::import::files::import_music_files,
            lyrics::embedded::get_track_lyrics,
            lyrics::sidecar::get_playback_sidecar_lyrics,
            lyrics::download::get_lyrics_download_targets,
            lyrics::download::search_lyrics_candidates,
            lyrics::download::get_candidate_lyrics,
            lyrics::download::find_track_lyrics,
            lyrics::batch::run_lyrics_download,
            lyrics::batch::commit_lyrics_download_step,
            lyrics::batch::complete_lyrics_download_step,
            lyrics::batch::cancel_lyrics_download,
            library::commands::list_artists,
            library::commands::list_albums,
            artwork::get_album_artwork,
            library::commands::list_album_tracks,
            library::commands::remove_track_from_library,
            playlist::commands::create_playlist,
            playlist::commands::rename_playlist,
            playlist::commands::delete_playlist,
            playlist::commands::add_track_to_playlist,
            playlist::commands::list_playlists,
            playlist::commands::list_playlist_tracks,
            playlist::commands::remove_playlist_items,
            playlist::commands::reorder_playlist_items,
            playback::queue::commands::list_skipped_track_ids,
            playback::queue::commands::set_tracks_skipped,
            library::commands::get_track,
            artwork::get_track_artwork,
            artwork::artist::get_artist_photo,
            artwork::artist::save_artist_photo,
            artwork::transfer::has_clipboard_artwork,
            artwork::transfer::read_clipboard_artwork,
            artwork::transfer::artwork_extensions,
            artwork::transfer::save_artwork,
            metadata::get_editable_tracks,
            metadata::save_track_metadata,
            metadata::releases::search_album_releases,
            metadata::releases::get_album_release,
            metadata::releases::get_release_covers,
            metadata::releases::get_release_cover,
            metadata::releases::save::save_album_tags,
            playback::session::runtime::playback_session_command,
            playback::session::runtime::playback_session_progress,
            playback::playback_spectrum,
            playback::statistics::list_playback_statistics,
        ])
        .run(tauri::generate_context!());
    if let Err(error) = &result {
        log::error!("event=application_run_failed error={error}");
        log::logger().flush();
    }
    result.expect("error while running tauri application");
}
