use super::super::*;

#[test]
fn shortcuts_default_only_for_a_missing_settings_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let new_user = SettingsState::load(path.clone()).unwrap().get().unwrap();
    assert_eq!(new_user.shortcuts.toggle_playback.shortcut, "Space");
    assert_eq!(new_user.shortcuts.show_commands.shortcut, "Ctrl+KeyK");
    std::fs::write(&path, r#"{"locale":"en"}"#).unwrap();
    let legacy = SettingsState::load(path.clone()).unwrap().get().unwrap();
    assert_eq!(
        legacy.shortcuts,
        crate::shortcuts::ShortcutSettings::default()
    );
    std::fs::write(&path, r#"{"shortcuts":{"previous":{"shortcut":"Ctrl+KeyP","global":true},"togglePlayback":{"shortcut":"","global":false}}}"#).unwrap();
    let state = SettingsState::load(path.clone()).unwrap();
    let settings = state.get().unwrap();
    assert_eq!(settings.shortcuts.previous.shortcut, "Ctrl+KeyP");
    assert!(settings.shortcuts.previous.global);
    assert!(settings.shortcuts.toggle_playback.shortcut.is_empty());
    assert!(settings.shortcuts.show_commands.shortcut.is_empty());
    state.save(settings.clone()).unwrap();
    assert_eq!(SettingsState::load(path).unwrap().get().unwrap(), settings);
}

#[test]
fn theme_mode_defaults_to_system_and_persists() {
    assert_eq!(Settings::default().theme_mode, ThemeMode::System);
    assert_eq!(
        serde_json::from_str::<Settings>("{}").unwrap().theme_mode,
        ThemeMode::System
    );
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    for (theme_mode, name) in [
        (ThemeMode::System, "system"),
        (ThemeMode::Light, "light"),
        (ThemeMode::Dark, "dark"),
    ] {
        let settings = Settings {
            theme_mode,
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["themeMode"], name);
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
        state.save(settings.clone()).unwrap();
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
    for value in [
        serde_json::json!("invalid"),
        serde_json::json!(null),
        serde_json::json!(true),
        serde_json::json!(1),
    ] {
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({"themeMode": value})).is_err()
        );
    }
}

#[test]
fn layout_density_defaults_round_trips_and_persists() {
    assert_eq!(Settings::default().layout_density, LayoutDensity::Regular);
    assert_eq!(
        serde_json::from_str::<Settings>("{}")
            .unwrap()
            .layout_density,
        LayoutDensity::Regular
    );
    assert!(serde_json::from_str::<Settings>(r#"{"layoutDensity":"invalid"}"#).is_err());
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    for layout_density in [LayoutDensity::Compact, LayoutDensity::Regular] {
        let settings = Settings {
            layout_density,
            ..Settings::default()
        };
        let data = serde_json::to_vec(&settings).unwrap();
        assert_eq!(serde_json::from_slice::<Settings>(&data).unwrap(), settings);
        state.save(settings.clone()).unwrap();
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
}

#[test]
fn statistics_visibility_defaults_to_enabled_and_persists() {
    assert!(Settings::default().show_playback_statistics);
    assert!(
        serde_json::from_str::<Settings>("{}")
            .unwrap()
            .show_playback_statistics
    );
    assert!(serde_json::from_str::<Settings>(r#"{"showPlaybackStatistics":"false"}"#).is_err());
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    for show_playback_statistics in [false, true] {
        state
            .save(Settings {
                show_playback_statistics,
                ..Settings::default()
            })
            .unwrap();
        assert_eq!(
            SettingsState::load(path.clone())
                .unwrap()
                .get()
                .unwrap()
                .show_playback_statistics,
            show_playback_statistics
        );
    }
}

#[test]
fn lightweight_mode_is_opt_in_and_persists() {
    assert!(!Settings::default().lightweight_on_close);
    assert!(
        !serde_json::from_str::<Settings>("{}")
            .unwrap()
            .lightweight_on_close
    );
    assert!(serde_json::from_str::<Settings>(r#"{"lightweightOnClose":"true"}"#).is_err());
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings.json");
    let state = SettingsState::load(path.clone()).unwrap();
    for enabled in [true, false] {
        state
            .save(Settings {
                lightweight_on_close: enabled,
                ..Settings::default()
            })
            .unwrap();
        assert_eq!(
            SettingsState::load(path.clone())
                .unwrap()
                .get()
                .unwrap()
                .lightweight_on_close,
            enabled
        );
    }
}

#[test]
fn defaults_to_background_playback() {
    assert_eq!(Settings::default().close_behavior, CloseBehavior::Tray);
}

#[test]
fn close_behavior_round_trips() {
    for close_behavior in [CloseBehavior::Tray, CloseBehavior::Exit] {
        let settings = Settings {
            close_behavior,
            ..Settings::default()
        };
        let data = serde_json::to_vec(&settings).unwrap();
        assert_eq!(serde_json::from_slice::<Settings>(&data).unwrap(), settings);
    }
}

#[test]
fn album_sorting_defaults_and_round_trips() {
    let defaults = Settings::default();
    assert_eq!(defaults.album_sort_by, AlbumSortBy::Name);
    assert_eq!(defaults.album_sort_order, AlbumSortOrder::Ascending);
    let settings: Settings = serde_json::from_str(r#"{"closeBehavior":"exit"}"#).unwrap();
    assert_eq!(settings.close_behavior, CloseBehavior::Exit);
    assert_eq!(settings.album_sort_by, AlbumSortBy::Name);
    assert_eq!(settings.album_sort_order, AlbumSortOrder::Ascending);
    for album_sort_by in [AlbumSortBy::Name, AlbumSortBy::Year] {
        for album_sort_order in [AlbumSortOrder::Ascending, AlbumSortOrder::Descending] {
            let settings = Settings {
                album_sort_by,
                album_sort_order,
                ..Settings::default()
            };
            let data = serde_json::to_vec(&settings).unwrap();
            assert_eq!(serde_json::from_slice::<Settings>(&data).unwrap(), settings);
        }
    }
}

#[test]
fn rejects_unknown_album_sorting_values() {
    assert!(serde_json::from_str::<Settings>(r#"{"albumSortBy":"invalid"}"#).is_err());
    assert!(serde_json::from_str::<Settings>(r#"{"albumSortOrder":"invalid"}"#).is_err());
}

#[test]
fn accent_color_defaults_and_round_trips() {
    for settings in [
        Settings::default(),
        serde_json::from_str::<Settings>("{}").unwrap(),
    ] {
        assert_eq!(settings.accent_color, "#1ed760");
    }
    for color in ["#000000", "#ffffff", "#1ed760", "#AbCdEf"] {
        let settings = Settings {
            accent_color: color.to_owned(),
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["accentColor"], color);
        assert!(data.get("theme").is_none());
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
    }
    assert!(serde_json::from_str::<Settings>(r#"{"theme":"spotify"}"#).is_err());
}

#[test]
fn accent_color_rejects_invalid_values() {
    for value in [
        serde_json::json!(""),
        serde_json::json!("#abc"),
        serde_json::json!("123456"),
        serde_json::json!("#12345678"),
        serde_json::json!("#12345g"),
        serde_json::json!(" #123456"),
        serde_json::json!("#123456\n"),
        serde_json::json!("#１２３"),
        serde_json::json!(null),
        serde_json::json!(123456),
        serde_json::json!(true),
        serde_json::json!([]),
        serde_json::json!({}),
    ] {
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({"accentColor": value})).is_err()
        );
    }
}

#[test]
fn accent_color_persists_normalized_and_loads_from_disk() {
    let path = std::env::temp_dir().join(format!("newbee-accent-{}.json", std::process::id()));
    let state = SettingsState::load(path.clone()).unwrap();
    assert_eq!(state.get().unwrap().accent_color, "#1ed760");
    let app = tauri::test::mock_builder()
        .manage(state)
        .manage(crate::playback::PlaybackState::default())
        .manage(crate::shortcuts::ShortcutsState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let settings = Settings {
        accent_color: "#AbCdEf".to_owned(),
        ..Settings::default()
    };
    tauri::async_runtime::block_on(save_settings_for_app(app.handle().clone(), settings)).unwrap();
    let expected = Settings {
        accent_color: "#abcdef".to_owned(),
        ..Settings::default()
    };
    assert_eq!(app.state::<SettingsState>().get().unwrap(), expected);
    assert_eq!(
        SettingsState::load(path.clone()).unwrap().get().unwrap(),
        expected
    );
    let data: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(data["accentColor"], "#abcdef");
    assert!(data.get("theme").is_none());
    std::fs::remove_file(path).unwrap();
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

#[test]
fn load_rejects_invalid_accent_color_and_legacy_theme() {
    let path = std::env::temp_dir().join(format!("newbee-accent-load-{}.json", std::process::id()));
    for data in [r##"{"accentColor":"#12345g"}"##, r#"{"theme":"spotify"}"#] {
        std::fs::write(&path, data).unwrap();
        assert!(SettingsState::load(path.clone()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), data);
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn cover_backgrounds_default_off() {
    for settings in [
        Settings::default(),
        serde_json::from_str::<Settings>("{}").unwrap(),
    ] {
        assert!(!settings.album_cover_background);
        assert!(!settings.playing_cover_background);
    }
}

#[test]
fn cover_backgrounds_round_trip_independently() {
    for album_cover_background in [false, true] {
        for playing_cover_background in [false, true] {
            let settings = Settings {
                album_cover_background,
                playing_cover_background,
                ..Settings::default()
            };
            let data = serde_json::to_value(&settings).unwrap();
            assert_eq!(data["albumCoverBackground"], album_cover_background);
            assert_eq!(data["playingCoverBackground"], playing_cover_background);
            assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
        }
    }
    let album_only: Settings = serde_json::from_str(r#"{"albumCoverBackground":true}"#).unwrap();
    assert!(album_only.album_cover_background);
    assert!(!album_only.playing_cover_background);
    let playing_only: Settings =
        serde_json::from_str(r#"{"playingCoverBackground":true}"#).unwrap();
    assert!(!playing_only.album_cover_background);
    assert!(playing_only.playing_cover_background);
}

#[test]
fn cover_backgrounds_reject_non_boolean_values() {
    for field in ["albumCoverBackground", "playingCoverBackground"] {
        for value in [
            serde_json::json!("true"),
            serde_json::json!(1),
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!({}),
        ] {
            let data = serde_json::json!({field: value});
            assert!(serde_json::from_value::<Settings>(data).is_err());
        }
    }
}

#[test]
fn lyrics_providers_default_enabled_and_preserve_disabled_settings() {
    use crate::lyrics::LyricsProvider;
    let defaults: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(defaults.lyrics_providers, vec![LyricsProvider::Netease]);
    for lyrics_providers in [vec![], vec![LyricsProvider::Netease]] {
        let settings = Settings {
            lyrics_providers,
            ..Settings::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        assert_eq!(serde_json::from_str::<Settings>(&json).unwrap(), settings);
    }
    assert!(serde_json::from_str::<Settings>(r#"{"lyricsProviders":["invalid"]}"#).is_err());
}

#[test]
fn netease_lyrics_mode_defaults_to_original_and_round_trips() {
    use crate::lyrics::NeteaseLyricsMode;
    let defaults: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(defaults.netease_lyrics_mode, NeteaseLyricsMode::Original);
    for (netease_lyrics_mode, name) in [
        (NeteaseLyricsMode::Original, "original"),
        (NeteaseLyricsMode::Translated, "translated"),
        (NeteaseLyricsMode::Bilingual, "bilingual"),
    ] {
        let settings = Settings {
            netease_lyrics_mode,
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["neteaseLyricsMode"], name);
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
    }
    assert!(serde_json::from_str::<Settings>(r#"{"neteaseLyricsMode":"invalid"}"#).is_err());
}

#[test]
fn rejects_unknown_close_behavior() {
    assert!(serde_json::from_str::<Settings>(r#"{"closeBehavior":"invalid"}"#).is_err());
}

#[test]
fn reduced_motion_defaults_off_and_round_trips() {
    assert!(!Settings::default().reduced_motion);
    assert!(
        !serde_json::from_str::<Settings>("{}")
            .unwrap()
            .reduced_motion
    );
    for reduced_motion in [false, true] {
        let settings = Settings {
            reduced_motion,
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["reducedMotion"], reduced_motion);
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
    }
    for value in [
        serde_json::json!("true"),
        serde_json::json!(1),
        serde_json::json!(null),
    ] {
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({"reducedMotion": value}))
                .is_err()
        );
    }
}

#[test]
fn reduced_motion_persists_and_loads_from_disk() {
    let path = std::env::temp_dir().join(format!("newbee-motion-{}.json", std::process::id()));
    let state = SettingsState::load(path.clone()).unwrap();
    assert!(!state.get().unwrap().reduced_motion);
    let app = tauri::test::mock_builder()
        .manage(state)
        .manage(crate::playback::PlaybackState::default())
        .manage(crate::shortcuts::ShortcutsState::default())
        .build(tauri::generate_context!())
        .unwrap();
    for reduced_motion in [true, false] {
        let settings = Settings {
            reduced_motion,
            ..Settings::default()
        };
        tauri::async_runtime::block_on(save_settings_for_app(
            app.handle().clone(),
            settings.clone(),
        ))
        .unwrap();
        assert_eq!(app.state::<SettingsState>().get().unwrap(), settings);
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn locale_defaults_and_round_trips() {
    assert_eq!(Settings::default().locale, Locale::ZhCn);
    assert_eq!(
        serde_json::from_str::<Settings>("{}").unwrap().locale,
        Locale::ZhCn
    );
    for (locale, value) in [(Locale::ZhCn, "zh-CN"), (Locale::En, "en")] {
        let settings = Settings {
            locale,
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["locale"], value);
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
    }
    for value in [
        serde_json::json!("invalid"),
        serde_json::json!("zh"),
        serde_json::json!(null),
        serde_json::json!(1),
    ] {
        assert!(serde_json::from_value::<Settings>(serde_json::json!({"locale": value})).is_err());
    }
}

#[test]
fn locale_persists_and_loads_from_disk() {
    let path = std::env::temp_dir().join(format!("newbee-locale-{}.json", std::process::id()));
    let state = SettingsState::load(path.clone()).unwrap();
    let app = tauri::test::mock_builder()
        .manage(state)
        .manage(crate::playback::PlaybackState::default())
        .manage(crate::shortcuts::ShortcutsState::default())
        .build(tauri::generate_context!())
        .unwrap();
    for locale in [Locale::En, Locale::ZhCn] {
        let settings = Settings {
            locale,
            ..Settings::default()
        };
        tauri::async_runtime::block_on(save_settings_for_app(
            app.handle().clone(),
            settings.clone(),
        ))
        .unwrap();
        assert_eq!(app.state::<SettingsState>().get().unwrap(), settings);
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn shortcuts_use_per_action_scope_and_reject_legacy_contract() {
    let defaults = serde_json::to_value(Settings::default()).unwrap();
    for action in ["previous", "next", "togglePlayback", "toggleWindow"] {
        assert_eq!(
            defaults["shortcuts"][action],
            serde_json::json!({"shortcut": "", "global": false})
        );
    }
    assert!(defaults["shortcuts"].get("global").is_none());
    let data = serde_json::json!({"shortcuts": {
        "previous": {"shortcut": "Ctrl+KeyA", "global": true},
        "next": {"shortcut": "Ctrl+KeyB", "global": false},
        "togglePlayback": {"shortcut": "Space", "global": false},
        "toggleWindow": {"shortcut": "Ctrl+KeyD", "global": true}
    }});
    let settings = serde_json::from_value::<Settings>(data.clone()).unwrap();
    let serialized = serde_json::to_value(&settings).unwrap();
    for (action, binding) in data["shortcuts"].as_object().unwrap() {
        assert_eq!(serialized["shortcuts"][action], *binding);
    }
    assert_eq!(serialized["shortcuts"]["showCommands"]["shortcut"], "");
    assert_eq!(
        serde_json::from_value::<Settings>(serialized).unwrap(),
        settings
    );
    for shortcuts in [
        serde_json::json!({"global": false}),
        serde_json::json!({"previous": "Ctrl+KeyA"}),
        serde_json::json!({"previous": {"shortcut": "Ctrl+KeyA", "global": "true"}}),
        serde_json::json!({"previous": {"shortcut": 1, "global": false}}),
        serde_json::json!({"previous": {"shortcut": "", "global": false, "unknown": true}}),
    ] {
        assert!(
            serde_json::from_value::<Settings>(serde_json::json!({"shortcuts": shortcuts}))
                .is_err()
        );
    }
}
