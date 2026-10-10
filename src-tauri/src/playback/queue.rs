use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub(super) const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueTrack {
    pub track_id: i64,
    pub row_key: String,
    pub title: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Queue {
    pub displayed_tracks: Vec<QueueTrack>,
    pub current_row_key: Option<String>,
    #[serde(deserialize_with = "deserialize_unique_row_keys")]
    pub next_row_keys: HashSet<String>,
    pub shuffle_enabled: bool,
    pub repeat_one_enabled: bool,
    #[serde(skip)]
    remaining: Vec<String>,
    #[serde(skip)]
    history: Vec<String>,
    #[serde(skip)]
    history_index: Option<usize>,
    #[serde(skip)]
    random_state: u64,
    #[serde(skip)]
    next_key: u64,
}

impl Queue {
    pub fn with_tracks(displayed_tracks: Vec<QueueTrack>) -> Self {
        Self {
            displayed_tracks,
            ..Self::default()
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        let mut keys = HashSet::new();
        for track in &self.displayed_tracks {
            if track.track_id <= 0
                || track.track_id > MAX_SAFE_INTEGER
                || track
                    .duration_ms
                    .is_some_and(|duration| duration > MAX_SAFE_INTEGER as u64)
                || track.row_key.trim().is_empty()
                || !keys.insert(&track.row_key)
            {
                return Err("Invalid playback queue rows".into());
            }
        }
        if self
            .current_row_key
            .as_ref()
            .is_some_and(|key| !keys.contains(key))
            || self.next_row_keys.iter().any(|key| !keys.contains(key))
        {
            return Err("Invalid playback queue selection".into());
        }
        Ok(())
    }

    pub fn restore(&mut self) {
        self.history.clear();
        self.history_index = None;
        self.rebuild_remaining();
    }

    pub fn current(&self) -> Option<&QueueTrack> {
        self.current_row_key.as_ref().and_then(|key| self.find(key))
    }

    pub fn find(&self, key: &str) -> Option<&QueueTrack> {
        self.displayed_tracks
            .iter()
            .find(|track| track.row_key == key)
    }

    fn current_index(&self) -> Option<usize> {
        self.displayed_tracks
            .iter()
            .position(|track| Some(&track.row_key) == self.current_row_key.as_ref())
    }

    pub fn start_round(&mut self, key: &str) {
        self.current_row_key = Some(key.into());
        self.restore();
    }

    pub fn candidates(
        &self,
        previous: bool,
        repeat: bool,
        skipped: &HashSet<i64>,
    ) -> Vec<QueueTrack> {
        let mut keys = Vec::new();
        if repeat && self.repeat_one_enabled {
            keys.extend(self.current_row_key.iter().cloned());
        }
        if !self.shuffle_enabled {
            if previous {
                if let Some(index) = self.current_index() {
                    keys.extend(
                        self.displayed_tracks[..index]
                            .iter()
                            .rev()
                            .map(|track| track.row_key.clone()),
                    );
                }
            } else {
                if let Some(index) = self.current_index() {
                    keys.extend(
                        self.displayed_tracks
                            .iter()
                            .skip(index + 1)
                            .map(|track| track.row_key.clone()),
                    );
                } else {
                    keys.extend(self.remaining.iter().cloned());
                }
            }
        } else if previous {
            if let Some(index) = self.history_index {
                keys.extend(self.history[..index].iter().rev().cloned());
            }
        } else {
            keys.extend(
                self.history
                    .iter()
                    .skip(self.history_index.map_or(0, |index| index + 1))
                    .cloned(),
            );
            keys.extend(self.remaining.iter().cloned());
        }
        keys.iter()
            .filter_map(|key| self.find(key))
            .filter(|track| !skipped.contains(&track.track_id))
            .cloned()
            .collect()
    }

    pub fn commit(&mut self, key: &str, previous: bool) {
        if self.current_row_key.as_deref() == Some(key) && self.history_index.is_some() {
            return;
        }
        let cursor = self.history_index.map_or(0, |index| index + 1);
        let existing = if previous {
            self.history[..cursor.saturating_sub(1)]
                .iter()
                .rposition(|entry| entry == key)
        } else {
            self.history
                .iter()
                .enumerate()
                .skip(cursor)
                .find(|(_, entry)| entry.as_str() == key)
                .map(|(index, _)| index)
        };
        if let Some(index) = existing {
            self.history_index = Some(index);
        } else {
            self.history.truncate(cursor);
            self.history.push(key.into());
            self.history_index = Some(self.history.len() - 1);
            if let Some(index) = self.remaining.iter().position(|entry| entry == key) {
                self.remaining.drain(..=index);
            }
        }
        self.current_row_key = Some(key.into());
    }

    pub fn set_shuffle(&mut self, enabled: bool) {
        if self.shuffle_enabled == enabled {
            return;
        }
        self.shuffle_enabled = enabled;
        if enabled {
            self.order_remaining();
        } else {
            self.rebuild_remaining();
        }
    }

    fn rebuild_remaining(&mut self) {
        self.remaining = self
            .displayed_tracks
            .iter()
            .skip(self.current_index().map_or(0, |index| index + 1))
            .map(|track| track.row_key.clone())
            .collect();
        self.order_remaining();
    }

    fn order_remaining(&mut self) {
        let mut regular: Vec<_> = self
            .remaining
            .iter()
            .filter(|key| !self.next_row_keys.contains(*key))
            .cloned()
            .collect();
        if self.shuffle_enabled {
            if self.random_state == 0 {
                self.random_state = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(1, |duration| duration.as_nanos() as u64)
                    | 1;
            }
            for index in (1..regular.len()).rev() {
                self.random_state ^= self.random_state << 13;
                self.random_state ^= self.random_state >> 7;
                self.random_state ^= self.random_state << 17;
                regular.swap(index, (self.random_state as usize) % (index + 1));
            }
        }
        self.remaining
            .retain(|key| self.next_row_keys.contains(key));
        self.remaining.extend(regular);
    }

    pub fn add(&mut self, mut tracks: Vec<QueueTrack>, next: bool) -> bool {
        if tracks.is_empty() {
            return false;
        }
        for track in &mut tracks {
            loop {
                self.next_key += 1;
                let key = format!("queue:{}", self.next_key);
                if self.find(&key).is_none() {
                    track.row_key = key;
                    break;
                }
            }
        }
        let keys: Vec<_> = tracks.iter().map(|track| track.row_key.clone()).collect();
        if next {
            self.next_row_keys.extend(keys.iter().cloned());
            let index = self.current_index().map_or(0, |index| index + 1);
            self.displayed_tracks.splice(index..index, tracks);
            if let Some(index) = self.history_index {
                self.history.splice(index + 1..index + 1, keys);
            } else {
                self.remaining.splice(0..0, keys);
            }
        } else {
            self.displayed_tracks.extend(tracks);
            self.remaining.extend(keys);
            self.order_remaining();
        }
        true
    }

    pub fn remove(&mut self, keys: &HashSet<String>) -> bool {
        let removed_current = self
            .current_row_key
            .as_ref()
            .is_some_and(|key| keys.contains(key));
        self.displayed_tracks
            .retain(|track| !keys.contains(&track.row_key));
        self.next_row_keys.retain(|key| !keys.contains(key));
        self.remaining.retain(|key| !keys.contains(key));
        if let Some(index) = self.history_index {
            let retained = self.history[..index]
                .iter()
                .filter(|key| !keys.contains(*key))
                .count();
            self.history_index = if keys.contains(&self.history[index]) {
                retained.checked_sub(1)
            } else {
                Some(retained)
            };
        }
        self.history.retain(|key| !keys.contains(key));
        if removed_current {
            self.current_row_key = None;
        }
        removed_current
    }
}

fn deserialize_unique_row_keys<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<HashSet<String>, D::Error> {
    let keys = Vec::<String>::deserialize(deserializer)?;
    let unique: HashSet<_> = keys.iter().cloned().collect();
    if keys.len() != unique.len() {
        return Err(serde::de::Error::custom(
            "Duplicate playback queue priorities",
        ));
    }
    Ok(unique)
}
