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
    pub playing_cover_background: bool,
    pub close_behavior: CloseBehavior,
    pub album_sort_by: AlbumSortBy,
    pub album_sort_order: AlbumSortOrder,
    #[serde(default = "crate::lyrics::default_providers")]
    pub lyrics_providers: Vec<crate::lyrics::LyricsProvider>,
    #[serde(default)]
    pub netease_lyrics_mode: crate::lyrics::NeteaseLyricsMode,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            album_cover_background: false,
            playing_cover_background: false,
            close_behavior: CloseBehavior::default(),
            album_sort_by: AlbumSortBy::default(),
            album_sort_order: AlbumSortOrder::default(),
            lyrics_providers: crate::lyrics::default_providers(),
            netease_lyrics_mode: crate::lyrics::NeteaseLyricsMode::default(),
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
                log::warn!("Could not read close behavior: {error}");
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
mod tests;
