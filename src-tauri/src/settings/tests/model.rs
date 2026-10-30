use super::super::*;

#[test]
fn legacy_fades_preserve_the_saved_choice_without_overwriting_independent_settings() {
    let legacy = serde_json::json!({ "playbackFade": false });
    let migrated = deserialize(legacy.clone()).unwrap();
    assert!(!migrated.playback_fade_in);
    assert!(!migrated.playback_fade_out);
    let mut mixed = legacy;
    mixed["playbackFadeOut"] = serde_json::json!(true);
    let migrated = deserialize(mixed).unwrap();
    assert!(!migrated.playback_fade_in);
    assert!(migrated.playback_fade_out);
    let saved = serde_json::to_value(migrated).unwrap();
    assert!(saved.get("playbackFade").is_none());
    assert_eq!(saved["playbackFadeIn"], false);
    assert_eq!(saved["playbackFadeOut"], true);
}

#[test]
fn invalid_accent_color_save_preserves_memory_and_disk() {
    let path =
        std::env::temp_dir().join(format!("newbee-invalid-accent-{}.json", std::process::id()));
    let state = SettingsState::load(path.clone()).unwrap();
    let expected = Settings {
        accent_color: "#123456".to_owned(),
        ..Settings::default()
    };
    state.save(expected.clone()).unwrap();
    let original = std::fs::read(&path).unwrap();
    let invalid = Settings {
        accent_color: "#bad".to_owned(),
        ..Settings::default()
    };
    assert!(state.save(invalid).is_err());
    assert_eq!(state.get().unwrap(), expected);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn accent_color_disk_write_failure_preserves_memory_and_disk() {
    let path = std::env::temp_dir().join(format!(
        "newbee-accent-write-failure-{}",
        std::process::id()
    ));
    let state = SettingsState::load(path.clone()).unwrap();
    let original = state.get().unwrap();
    std::fs::create_dir(&path).unwrap();
    let sentinel = path.join("sentinel");
    std::fs::write(&sentinel, b"unchanged").unwrap();
    let settings = Settings {
        accent_color: "#abcdef".to_owned(),
        ..Settings::default()
    };
    assert!(state.save(settings).is_err());
    assert_eq!(state.get().unwrap(), original);
    assert!(path.is_dir());
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"unchanged");
    std::fs::remove_dir_all(path).unwrap();
}
