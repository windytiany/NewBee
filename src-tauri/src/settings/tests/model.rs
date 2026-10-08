use super::super::*;

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
fn theme_defaults_and_round_trips() {
    let settings: Settings = serde_json::from_str(r#"{"closeBehavior":"exit"}"#).unwrap();
    assert_eq!(settings.theme, Theme::Spotify);
    for (theme, name) in [
        (Theme::Spotify, "spotify"),
        (Theme::TokyoNight, "tokyoNight"),
        (Theme::Catppuccin, "catppuccin"),
    ] {
        let settings = Settings {
            theme,
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["theme"], name);
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
    }
    assert!(serde_json::from_str::<Settings>(r#"{"theme":"invalid"}"#).is_err());
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
        .build(tauri::generate_context!())
        .unwrap();
    for reduced_motion in [true, false] {
        let settings = Settings {
            reduced_motion,
            ..Settings::default()
        };
        tauri::async_runtime::block_on(save_settings(app.handle().clone(), settings.clone()))
            .unwrap();
        assert_eq!(app.state::<SettingsState>().get().unwrap(), settings);
        assert_eq!(
            SettingsState::load(path.clone()).unwrap().get().unwrap(),
            settings
        );
    }
    std::fs::remove_file(path).unwrap();
}
