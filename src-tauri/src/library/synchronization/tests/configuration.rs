use super::super::{
    configuration::{normalize, Folder, Mode},
    inventory,
};
use crate::fixtures::TestFiles;

#[test]
fn folders_require_enabled_and_preserve_explicit_disabling() {
    assert!(serde_json::from_value::<Folder>(
        serde_json::json!({"path": "D:/Music", "mode": "startup"})
    )
    .is_err());
    let disabled: Folder = serde_json::from_value(
        serde_json::json!({"path": "D:/Music", "mode": "continuous", "enabled": false}),
    )
    .unwrap();
    assert!(!disabled.enabled);
    assert_eq!(serde_json::to_value(disabled).unwrap()["enabled"], false);
}

#[test]
fn rejects_duplicate_roots_and_preserves_distinct_nested_modes() {
    let files = TestFiles::new();
    std::fs::create_dir(files.0.join("child")).unwrap();
    let root = Folder {
        path: files.0.to_string_lossy().into(),
        mode: Mode::Startup,
        enabled: true,
    };
    let mut folders = vec![root.clone(), root.clone()];
    assert!(normalize(&mut folders, &[]).is_err());
    folders[1].path = files.0.join("child").to_string_lossy().into();
    folders[1].mode = Mode::Continuous;
    normalize(&mut folders, &[]).unwrap();
    assert_eq!(folders[0].mode, Mode::Startup);
    assert_eq!(folders[1].mode, Mode::Continuous);
    let other = TestFiles::new();
    folders[1].path = other.0.to_string_lossy().into();
    normalize(&mut folders, &[]).unwrap();
}

#[test]
fn retains_existing_unavailable_roots_but_rejects_new_ones() {
    let files = TestFiles::new();
    let folder = Folder {
        path: files.0.join("missing").to_string_lossy().into(),
        mode: Mode::Startup,
        enabled: true,
    };
    assert!(normalize(&mut [folder.clone()], &[]).is_err());
    normalize(&mut [folder.clone()], &[folder]).unwrap();
}

#[test]
fn configuration_persists_and_rejects_duplicates_atomically() {
    use crate::settings::{Settings, SettingsState};
    let files = TestFiles::new();
    std::fs::create_dir(files.0.join("child")).unwrap();
    let path = files.0.join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    assert!(state.get().unwrap().synchronization_folders.is_empty());
    let folder = Folder {
        path: files.0.to_string_lossy().into(),
        mode: Mode::Continuous,
        enabled: true,
    };
    state
        .save(Settings {
            synchronization_folders: vec![folder.clone()],
            ..Settings::default()
        })
        .unwrap();
    let persisted = std::fs::read(&path).unwrap();
    let loaded = SettingsState::load(path.clone()).unwrap().get().unwrap();
    assert_eq!(loaded.synchronization_folders, vec![folder.clone()]);
    let mut invalid = loaded.clone();
    invalid.synchronization_folders.push(Folder {
        path: folder.path,
        mode: Mode::Manual,
        enabled: true,
    });
    assert!(state.save(invalid).is_err());
    assert_eq!(state.get().unwrap(), loaded);
    assert_eq!(std::fs::read(path).unwrap(), persisted);
}

#[test]
fn inventory_is_recursive_and_detects_non_audio_changes() {
    let files = TestFiles::new();
    std::fs::create_dir(files.0.join("child")).unwrap();
    files.wav("child/song.wav");
    let before = inventory::inspect(&files.0).unwrap();
    assert_eq!(inventory::audio(&before).len(), 1);
    files.write("cover.png", b"picture");
    assert_ne!(before, inventory::inspect(&files.0).unwrap());
    assert!(inventory::inspect(&files.0.join("missing")).is_err());
}

#[test]
fn folder_commands_allow_scanning_but_respect_exclusive_tasks() {
    use crate::{
        locking::WriteState,
        settings::{Locale, Settings, SettingsState},
    };
    use tauri::Manager;
    let files = TestFiles::new();
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    settings
        .save(Settings {
            locale: Locale::En,
            ..Settings::default()
        })
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(settings)
        .manage(WriteState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let folders = vec![Folder {
        path: files.0.to_string_lossy().into_owned(),
        mode: Mode::Manual,
        enabled: true,
    }];
    let scan = app.state::<WriteState>().acquire().unwrap();
    let saved =
        tauri::async_runtime::block_on(super::super::commands::save_synchronization_folders(
            app.handle().clone(),
            app.state(),
            folders,
        ))
        .unwrap();
    assert_eq!(
        super::super::commands::get_synchronization_folders(app.state()).unwrap(),
        saved
    );
    assert_eq!(
        app.state::<SettingsState>().get().unwrap().locale,
        Locale::En
    );
    assert_eq!(
        app.state::<SettingsState>()
            .get()
            .unwrap()
            .synchronization_folders,
        saved
    );
    drop(scan);
    let guard = app.state::<WriteState>().acquire_all().unwrap();
    assert!(
        tauri::async_runtime::block_on(super::super::commands::save_synchronization_folders(
            app.handle().clone(),
            app.state(),
            Vec::new(),
        ))
        .is_err()
    );
    assert_eq!(
        app.state::<SettingsState>()
            .get()
            .unwrap()
            .synchronization_folders,
        saved
    );
    drop(guard);
}
