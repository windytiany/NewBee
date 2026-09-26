mod playback;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(playback::PlaybackState::default())
        .plugin(tauri_plugin_opener::init())
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
