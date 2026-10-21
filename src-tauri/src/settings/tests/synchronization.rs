use super::super::*;
use crate::{
    fixtures::TestFiles,
    library::synchronization::configuration::{Folder, Mode},
    locking::WriteState,
};

#[test]
fn settings_save_succeeds_while_scanning() {
    let files = TestFiles::new();
    let app = tauri::test::mock_builder()
        .manage(SettingsState::load(files.0.join("settings.json")).unwrap())
        .manage(WriteState::default())
        .manage(crate::playback::PlaybackState::default())
        .manage(crate::shortcuts::ShortcutsState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let next = Settings {
        locale: Locale::En,
        ..Settings::default()
    };
    let _scan = app.state::<WriteState>().acquire().unwrap();
    tauri::async_runtime::block_on(save_settings_for_app(app.handle().clone(), next.clone()))
        .unwrap();
    assert_eq!(app.state::<SettingsState>().get().unwrap(), next);
    assert_eq!(
        SettingsState::load(files.0.join("settings.json"))
            .unwrap()
            .get()
            .unwrap(),
        next
    );
}

#[test]
fn settings_save_cannot_race_remapping_or_backup() {
    let files = TestFiles::new();
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    let before = settings.get().unwrap();
    let app = tauri::test::mock_builder()
        .manage(settings)
        .manage(WriteState::default())
        .manage(crate::playback::PlaybackState::default())
        .manage(crate::shortcuts::ShortcutsState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let next = Settings {
        locale: Locale::En,
        synchronization_folders: vec![Folder {
            path: files.0.to_string_lossy().into_owned(),
            mode: Mode::Manual,
            enabled: true,
        }],
        ..Settings::default()
    };
    let guard = app.state::<WriteState>().acquire_all().unwrap();
    assert!(tauri::async_runtime::block_on(save_settings_for_app(
        app.handle().clone(),
        next.clone()
    ))
    .is_err());
    assert_eq!(app.state::<SettingsState>().get().unwrap(), before);
    assert!(!files.0.join("settings.json").exists());
    drop(guard);
    tauri::async_runtime::block_on(save_settings_for_app(app.handle().clone(), next.clone()))
        .unwrap();
    assert_eq!(app.state::<SettingsState>().get().unwrap(), next);
}
