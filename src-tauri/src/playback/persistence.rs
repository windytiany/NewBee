use super::queue::Queue;
use super::session::ListeningTrack;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedSession {
    pub queue: Queue,
    pub current_track: Option<ListeningTrack>,
    pub volume: VolumePreferences,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VolumePreferences {
    pub volume: u8,
    pub last_non_muted_volume: u8,
}

impl Default for VolumePreferences {
    fn default() -> Self {
        Self {
            volume: 50,
            last_non_muted_volume: 50,
        }
    }
}

impl VolumePreferences {
    pub fn validate(&self) -> Result<(), String> {
        if self.volume > 100
            || self.last_non_muted_volume == 0
            || self.last_non_muted_volume > 100
            || self.volume > 0 && self.last_non_muted_volume != self.volume
        {
            return Err("Invalid saved playback volume".into());
        }
        Ok(())
    }
}

impl SavedSession {
    pub(crate) fn validate(&self) -> Result<(), String> {
        self.queue.validate()?;
        self.volume.validate()?;
        if self
            .current_track
            .as_ref()
            .is_some_and(|track| match (track.track_id, &track.path) {
                (Some(id), _) => id <= 0,
                (None, Some(path)) => !Path::new(path).is_absolute(),
                _ => true,
            })
        {
            return Err("Invalid saved current track".into());
        }
        Ok(())
    }
}

pub struct SessionPersistence {
    path: PathBuf,
    last_saved: Option<String>,
    pub(super) restored: bool,
}

impl SessionPersistence {
    pub fn load(path: PathBuf) -> (Self, SavedSession) {
        let saved = match std::fs::read_to_string(&path) {
            Ok(serialized) => serde_json::from_str::<SavedSession>(&serialized)
                .map_err(|error| error.to_string())
                .and_then(|saved| {
                    saved.validate()?;
                    Ok(saved)
                }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(SavedSession::default())
            }
            Err(error) => Err(error.to_string()),
        };
        let restored = saved.is_ok();
        let saved = saved.unwrap_or_else(|error| {
            log::warn!("Could not restore playback session: {error}");
            SavedSession::default()
        });
        (
            Self {
                path,
                last_saved: None,
                restored,
            },
            saved,
        )
    }

    pub fn save(&mut self, saved: &SavedSession) -> Result<(), String> {
        saved.validate()?;
        let serialized = serde_json::to_string(saved).map_err(|error| error.to_string())?;
        if self.last_saved.as_ref() == Some(&serialized) {
            return Ok(());
        }
        write_snapshot(&self.path, &serialized)?;
        self.last_saved = Some(serialized);
        Ok(())
    }
}

fn write_snapshot(path: &Path, serialized: &str) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serialized)
        .map_err(|error| format!("Could not save playback session: {error}"))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("Could not replace playback session: {error}"))
}
