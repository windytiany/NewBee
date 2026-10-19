use super::super::*;

#[test]
fn playback_defaults_on_but_tag_writing_is_opt_in_and_both_persist() {
    let legacy: Settings = serde_json::from_str("{}").unwrap();
    assert!(legacy.replay_gain);
    assert!(!legacy.scan_replay_gain);
    assert_eq!(legacy.replay_gain_preamp, 0.0);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    for enabled in [true, false] {
        let settings = Settings {
            replay_gain: !enabled,
            scan_replay_gain: enabled,
            replay_gain_preamp: if enabled { -3.5 } else { 6.0 },
            ..Settings::default()
        };
        state.save(settings.clone()).unwrap();
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
    assert!(serde_json::from_str::<Settings>(r#"{"scanReplayGain":"true"}"#).is_err());
}

#[test]
fn preamp_rejects_invalid_values_without_changing_saved_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    let original = state.get().unwrap();
    state.save(original.clone()).unwrap();
    for value in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -20.5,
        20.5,
        0.25,
    ] {
        assert!(state
            .save(Settings {
                replay_gain_preamp: value,
                ..original.clone()
            })
            .is_err());
        assert_eq!(state.get().unwrap(), original);
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            original
        );
    }
    for value in ["null", "\"3\"", "-20.5", "20.5", "0.25"] {
        assert!(
            serde_json::from_str::<Settings>(&format!(r#"{{"replayGainPreamp":{value}}}"#))
                .is_err()
        );
    }
    for value in [-20.0, -0.5, 0.0, 0.5, 20.0] {
        let settings = Settings {
            replay_gain_preamp: value,
            ..original.clone()
        };
        state.save(settings.clone()).unwrap();
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
}
