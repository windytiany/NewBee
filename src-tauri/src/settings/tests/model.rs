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
fn album_cover_background_defaults_off_and_round_trips() {
    assert!(!Settings::default().album_cover_background);
    let settings: Settings = serde_json::from_str(r#"{"theme":"spotify"}"#).unwrap();
    assert!(!settings.album_cover_background);
    for enabled in [false, true] {
        let settings = Settings {
            album_cover_background: enabled,
            ..Settings::default()
        };
        let data = serde_json::to_value(&settings).unwrap();
        assert_eq!(data["albumCoverBackground"], enabled);
        assert_eq!(serde_json::from_value::<Settings>(data).unwrap(), settings);
    }
    assert!(serde_json::from_str::<Settings>(r#"{"albumCoverBackground":"true"}"#).is_err());
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
fn rejects_unknown_close_behavior() {
    assert!(serde_json::from_str::<Settings>(r#"{"closeBehavior":"invalid"}"#).is_err());
}
