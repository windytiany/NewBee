use super::*;
use crate::{
    database::Database, fixtures::TestFiles, library::synchronization::SynchronizationState,
    settings::Settings,
};
use tauri::Manager;

#[test]
fn scan_paths_persist_independently_and_survive_stale_settings_saves() {
    let files = TestFiles::new();
    let settings_path = files.0.join("settings.json");
    let state = SettingsState::load(settings_path.clone()).unwrap();
    let stale = state.get().unwrap();
    let paths = vec![files.0.to_string_lossy().into_owned()];
    state.update_scan_folders(paths.clone()).unwrap();
    state.save(stale).unwrap();
    let loaded = SettingsState::load(settings_path).unwrap().get().unwrap();
    assert_eq!(loaded.scan_folders, paths);
    assert!(loaded.synchronization_folders.is_empty());
}

#[test]
fn scanning_uses_only_submitted_paths_without_changing_automatic_folders() {
    let manual = TestFiles::new();
    let automatic = TestFiles::new();
    let manual_track = manual.wav("manual.wav");
    automatic.wav("automatic.wav");
    let settings = SettingsState::load(manual.0.join("settings.json")).unwrap();
    settings
        .save(Settings {
            synchronization_folders: vec![Folder {
                path: automatic.0.to_string_lossy().into_owned(),
                mode: Mode::Continuous,
                enabled: true,
            }],
            ..Settings::default()
        })
        .unwrap();
    let before = settings.get().unwrap();
    let app = tauri::test::mock_builder()
        .manage(settings)
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .manage(SynchronizationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    // Native folder pickers return ordinary drive paths, unlike canonicalized fixtures.
    let submitted = manual.0.to_string_lossy().into_owned();
    #[cfg(windows)]
    let submitted = submitted
        .strip_prefix(r"\\?\")
        .unwrap_or(&submitted)
        .to_owned();
    let result = tauri::async_runtime::block_on(scan_library(
        vec![submitted],
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert_eq!(result.added, 1);
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap(),
        vec![manual_track]
    );
    assert_eq!(app.state::<SettingsState>().get().unwrap(), before);
}
