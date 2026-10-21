mod artwork;
mod backup;
mod database;
#[cfg(test)]
mod fixtures;
mod inbox;
mod library;
mod locking;
mod logging;
pub mod lyrics;
mod metadata;
mod playback;
mod playlist;
mod remapping;
mod settings;
mod shortcuts;
mod tracks;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .manage(playback::PlaybackState::default())
        .manage(tracks::ConfirmationState::default())
        .manage(locking::WriteState::default())
        .manage(artwork::artist::LookupState::default())
        .manage(backup::BackupState::default())
        .manage(library::synchronization::SynchronizationState::default())
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
                let settings = app.state::<settings::SettingsState>().get()?;
                app.state::<playback::PlaybackState>()
                    .set_replay_gain(settings.replay_gain, settings.replay_gain_preamp);
                stage = "library_synchronization";
                library::synchronization::migration::run(
                    &app.state::<database::Database>(),
                    &app.state::<settings::SettingsState>(),
                )?;
                library::synchronization::initialize(app.handle())?;
                stage = "playback_statistics";
                playback::statistics::initialize(app.handle());
                stage = "playback_session";
                playback::session::initialize(
                    app.handle(),
                    app_data_dir.join("playback-session.json"),
                )?;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            window::lightweight::advance_lightweight,
            window::lightweight::cancel_lightweight,
            settings::get_settings,
            settings::save_settings,
            library::synchronization::get_library_synchronization,
            library::synchronization::resolve_library_synchronization,
            library::synchronization::commands::get_synchronization_folders,
            library::synchronization::commands::save_synchronization_folders,
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
            remapping::remap_paths,
            library::synchronization::commands::synchronize_library,
            tracks::discovery::supported_audio_extensions,
            tracks::discovery::readable_audio_files,
            tracks::discovery::preview_local_drop,
            library::import::files::import_music_files,
            lyrics::embedded::get_track_lyrics,
            lyrics::embedded::get_file_lyrics,
            lyrics::sidecar::get_file_sidecar_lyrics,
            lyrics::download::find_file_lyrics,
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
            artwork::track::commands::get_album_artwork,
            library::commands::list_album_tracks,
            library::commands::list_external_track_ids,
            library::commands::remove_track_from_library,
            playlist::commands::create_playlist,
            playlist::discovery::playlist_directories,
            playlist::commands::rename_playlist,
            playlist::commands::delete_playlist,
            playlist::commands::append_playlist_tracks,
            playlist::commands::list_playlists,
            playlist::commands::list_playlist_tracks,
            playlist::commands::remove_playlist_items,
            playlist::commands::reorder_playlist_items,
            playback::skip::list_skipped_track_ids,
            playback::skip::set_tracks_skipped,
            tracks::commands::get_track,
            tracks::commands::get_tracks,
            tracks::commands::register_local_tracks,
            tracks::commands::reread_track_tags,
            metadata::replaygain::commands::analyze_track_loudness,
            metadata::replaygain::commands::restore_track_loudness,
            tracks::commands::is_track_metadata_pending,
            tracks::commands::get_track_presentation,
            artwork::track::commands::get_track_artwork,
            artwork::track::commands::get_track_artwork_collections,
            artwork::track::commands::get_artwork_picture,
            artwork::track::linked::read_artwork_file,
            artwork::track::plan::get_artwork_write_plan,
            artwork::artist::get_artist_photo,
            artwork::artist::find_artist_photo,
            artwork::artist::save_artist_photo,
            artwork::transfer::has_clipboard_artwork,
            artwork::transfer::read_clipboard_artwork,
            artwork::transfer::artwork_extensions,
            artwork::transfer::save_artwork,
            inbox::read_inbox,
            inbox::register_inbox,
            inbox::remove_inbox,
            inbox::ingest_inbox,
            metadata::get_editable_tracks,
            metadata::save_track_metadata,
            metadata::releases::search_album_releases,
            metadata::releases::get_album_release,
            metadata::releases::get_release_covers,
            metadata::releases::get_release_cover,
            metadata::releases::save::save_album_tags,
            playback::session::runtime::playback_session_command,
            playback::session::runtime::playback_session_progress,
            playback::session::runtime::playback_session_metadata,
            playback::playback_spectrum,
            playback::statistics::list_playback_statistics,
        ])
        .build(tauri::generate_context!());
    if let Err(error) = &result {
        log::error!("event=application_run_failed error={error}");
        log::logger().flush();
    }
    result
        .expect("error while running tauri application")
        .run(|app, event| {
            // Releasing the last WebView must not stop backend playback or the tray.
            // Explicit exit/restart requests carry an exit code and remain unchanged.
            if let tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } = &event
            {
                if window::lightweight::keep_alive(app) {
                    api.prevent_exit();
                }
            }
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
            {
                if label == "main" {
                    // Tauri has removed the old label before this callback, so it
                    // is now safe to honor a restore queued during destruction.
                    window::lightweight::destroyed(app);
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                use tauri::Manager;
                app.state::<library::synchronization::SynchronizationState>()
                    .stop();
                app.state::<tracks::ConfirmationState>().stop();
            }
        });
}
