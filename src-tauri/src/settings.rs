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

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub close_behavior: CloseBehavior,
    pub album_sort_by: AlbumSortBy,
    pub album_sort_order: AlbumSortOrder,
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
    fn rejects_unknown_close_behavior() {
        assert!(serde_json::from_str::<Settings>(r#"{"closeBehavior":"invalid"}"#).is_err());
    }
}
