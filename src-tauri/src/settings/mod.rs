use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
pub enum Locale {
    #[default]
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}

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

fn validate_accent_color(color: &str) -> Result<(), String> {
    if color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        Ok(())
    } else {
        Err("Accent color must use #RRGGBB format".to_owned())
    }
}

fn deserialize_accent_color<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let color = String::deserialize(deserializer)?;
    validate_accent_color(&color).map_err(serde::de::Error::custom)?;
    Ok(color)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub locale: Locale,
    pub shortcuts: crate::shortcuts::ShortcutSettings,
    #[serde(deserialize_with = "deserialize_accent_color")]
    pub accent_color: String,
    pub reduced_motion: bool,
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
            locale: Locale::default(),
            shortcuts: crate::shortcuts::ShortcutSettings::default(),
            accent_color: "#1ed760".to_owned(),
            reduced_motion: false,
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

    fn save(&self, mut settings: Settings) -> Result<(), String> {
        validate_accent_color(&settings.accent_color)?;
        settings.accent_color.make_ascii_lowercase();
        let mut providers = std::collections::HashSet::new();
        if settings
            .lyrics_providers
            .iter()
            .any(|provider| !providers.insert(*provider))
        {
            return Err("歌词来源不能重复".to_owned());
        }
        let mut current = self
            .settings
            .lock()
            .map_err(|error| format!("Could not update settings: {error}"))?;
        let data = serde_json::to_vec_pretty(&settings)
            .map_err(|error| format!("Could not serialize settings: {error}"))?;
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, data)
            .and_then(|_| std::fs::rename(&temporary, &self.path))
            .map_err(|error| {
                if let Err(cleanup) = std::fs::remove_file(&temporary) {
                    if cleanup.kind() != std::io::ErrorKind::NotFound {
                        log::warn!("Could not remove temporary settings: {cleanup}");
                    }
                }
                format!("Could not save settings: {error}")
            })?;
        *current = settings;
        Ok(())
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
pub async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    save_settings_for_app(app, settings).await
}

async fn save_settings_for_app<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: Settings,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let locale = settings.locale;
        crate::shortcuts::save_configuration(&app, &settings.shortcuts.clone(), || {
            app.state::<SettingsState>().save(settings)
        })?;
        if let Err(error) = crate::window::tray::update_locale(&app, locale) {
            log::warn!("Could not update tray menu language: {error}");
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Could not save settings: {error}"))?
}

#[cfg(test)]
mod tests;
