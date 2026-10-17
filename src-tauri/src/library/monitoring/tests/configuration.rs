use super::super::{
    configuration::{normalize, Folder, Mode},
    inventory,
};
use crate::library::import::tests::support::TestFiles;

#[test]
fn legacy_folders_default_to_enabled_and_explicit_disabling_is_preserved() {
    let legacy: Folder =
        serde_json::from_value(serde_json::json!({"path": "D:/Music", "mode": "startup"})).unwrap();
    assert!(legacy.enabled);
    let disabled: Folder = serde_json::from_value(
        serde_json::json!({"path": "D:/Music", "mode": "continuous", "enabled": false}),
    )
    .unwrap();
    assert!(!disabled.enabled);
    assert_eq!(serde_json::to_value(disabled).unwrap()["enabled"], false);
}

#[test]
fn rejects_duplicate_and_nested_roots_but_not_siblings() {
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
    assert!(normalize(&mut folders, &[]).is_err());
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
fn configuration_persists_and_rejects_overlap_atomically() {
    use crate::settings::{Settings, SettingsState};
    let files = TestFiles::new();
    std::fs::create_dir(files.0.join("child")).unwrap();
    let path = files.0.join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    assert!(state.get().unwrap().monitoring_folders.is_empty());
    let folder = Folder {
        path: files.0.to_string_lossy().into(),
        mode: Mode::Continuous,
        enabled: true,
    };
    state
        .save(Settings {
            monitoring_folders: vec![folder.clone()],
            ..Settings::default()
        })
        .unwrap();
    let persisted = std::fs::read(&path).unwrap();
    let loaded = SettingsState::load(path.clone()).unwrap().get().unwrap();
    assert_eq!(loaded.monitoring_folders, vec![folder.clone()]);
    let mut invalid = loaded.clone();
    invalid.monitoring_folders.push(Folder {
        path: files.0.join("child").to_string_lossy().into(),
        mode: Mode::Startup,
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
