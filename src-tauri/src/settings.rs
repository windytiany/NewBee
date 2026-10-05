use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::State;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CloseBehavior {
    #[default]
    Tray,
    Exit,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AlbumSortBy {
    #[default]
    Name,
    Year,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AlbumSortOrder {
    #[default]
    Ascending,
    Descending,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Spotify,
    TokyoNight,
    Catppuccin,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub theme: Theme,
    pub album_cover_background: bool,
    pub close_behavior: CloseBehavior,
    pub album_sort_by: AlbumSortBy,
    pub album_sort_order: AlbumSortOrder,
    #[serde(default = "crate::lyrics_download::default_providers")]
    pub lyrics_providers: Vec<crate::lyrics_download::LyricsProvider>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            album_cover_background: false,
            close_behavior: CloseBehavior::default(),
            album_sort_by: AlbumSortBy::default(),
            album_sort_order: AlbumSortOrder::default(),
            lyrics_providers: crate::lyrics_download::default_providers(),
        }
    }
}

pub struct SettingsState {
    settings: Mutex<Settings>,
    path: PathBuf,
}

impl SettingsState {
    pub fn load(path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let settings = match std::fs::read(&path) {
            Ok(data) => serde_json::from_slice(&data)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            settings: Mutex::new(settings),
            path,
        })
    }

    pub fn get(&self) -> Result<Settings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|error| format!("Could not read settings: {error}"))
    }

    pub fn close_behavior(&self) -> CloseBehavior {
        match self.settings.lock() {
            Ok(settings) => settings.close_behavior,
            Err(error) => {
                eprintln!("Could not read close behavior: {error}");
                CloseBehavior::Tray
            }
        }
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<Settings, String> {
    state.get()
}

#[tauri::command]
pub fn save_settings(state: State<'_, SettingsState>, settings: Settings) -> Result<(), String> {
    let mut providers = std::collections::HashSet::new();
    if settings
        .lyrics_providers
        .iter()
        .any(|provider| !providers.insert(*provider))
    {
        return Err("歌词来源不能重复".to_owned());
    }
    let mut current = state
        .settings
        .lock()
        .map_err(|error| format!("Could not update settings: {error}"))?;
    let data = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("Could not serialize settings: {error}"))?;
    std::fs::write(&state.path, data)
        .map_err(|error| format!("Could not save settings: {error}"))?;
    *current = settings;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        use crate::lyrics_download::LyricsProvider;
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
}
