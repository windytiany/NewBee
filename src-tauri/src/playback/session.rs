pub(crate) use super::persistence::SavedSession;
use super::persistence::VolumePreferences;
use super::queue::{Queue, QueueTrack, MAX_SAFE_INTEGER};
use super::{NowPlayingTrack, PlaybackStatus};
pub(crate) use runtime::backup_snapshot;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub trait SessionAudio {
    fn start(&mut self, track_id: i64, row_key: &str) -> Result<NowPlayingTrack, String>;
    fn status(&self) -> Result<PlaybackStatus, String>;
    fn prepare(
        &mut self,
        playback_id: u64,
        revision: u64,
        track: Option<&QueueTrack>,
    ) -> Result<bool, String>;
    fn stop(&mut self, playback_id: u64) -> Result<bool, String>;
    fn pause(&mut self) -> Result<(), String>;
    fn resume(&mut self) -> Result<(), String>;
    fn seek(&mut self, position_ms: u64) -> Result<(), String>;
    fn set_volume(&mut self, volume: u8) -> Result<(), String>;
    fn skipped(&self) -> HashSet<i64>;
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListeningTrack {
    pub track_id: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
}

impl From<&NowPlayingTrack> for ListeningTrack {
    fn from(track: &NowPlayingTrack) -> Self {
        Self {
            track_id: track.track_id,
            title: track.title.clone(),
            artist: track.artist.clone(),
        }
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SessionCommand {
    System {
        operation: SystemOperation,
    },
    Snapshot,
    PlayTracks {
        tracks: Vec<QueueTrack>,
        start_row_key: String,
        allow_skipped: bool,
    },
    PlayItem {
        row_key: String,
    },
    Previous,
    Next,
    Toggle,
    Play,
    Pause,
    BeginSeeking,
    Volume {
        volume: u8,
    },
    Mute,
    Seek {
        position_ms: u64,
        playback_id: Option<u64>,
    },
    Add {
        tracks: Vec<QueueTrack>,
        next: bool,
    },
    Remove {
        row_keys: Vec<String>,
    },
    RemoveTrack {
        track_id: i64,
    },
    Clear,
    Repeat {
        enabled: bool,
    },
    Shuffle {
        enabled: bool,
    },
    BeginEditing {
        track_ids: Vec<i64>,
    },
    EndEditing {
        token: u64,
    },
    UpdateMetadata {
        tracks: Vec<MetadataUpdate>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataUpdate {
    id: i64,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemOperation {
    Play,
    Pause,
    Toggle,
    Previous,
    Next,
}

impl SystemOperation {
    fn command(self) -> SessionCommand {
        match self {
            Self::Play => SessionCommand::Play,
            Self::Pause => SessionCommand::Pause,
            Self::Toggle => SessionCommand::Toggle,
            Self::Previous => SessionCommand::Previous,
            Self::Next => SessionCommand::Next,
        }
    }
}

impl SessionCommand {
    fn invalidates(&self) -> bool {
        matches!(
            self,
            Self::System { .. }
                | Self::PlayTracks { .. }
                | Self::PlayItem { .. }
                | Self::Previous
                | Self::Next
                | Self::Toggle
                | Self::Play
                | Self::Pause
                | Self::BeginSeeking
                | Self::Remove { .. }
                | Self::RemoveTrack { .. }
                | Self::Clear
                | Self::BeginEditing { .. }
        )
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub revision: u64,
    pub displayed_tracks: Vec<QueueTrack>,
    pub current_row_key: Option<String>,
    pub current_track: Option<ListeningTrack>,
    pub current_playback_id: Option<u64>,
    pub playback_status: PlaybackStatus,
    pub queue_playback_error: String,
    pub playback_error: String,
    pub shuffle_enabled: bool,
    pub repeat_one_enabled: bool,
    pub can_play_previous: bool,
    pub can_play_next: bool,
    pub skipped_track_ids: Vec<i64>,
    pub volume: u8,
    pub is_editing: bool,
    pub is_command_pending: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum RemovalResult {
    NotFound,
    Removed,
    StopFailed { message: String },
    QueueError { message: String },
    StopUnconfirmed,
    Superseded,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReply {
    snapshot: SessionSnapshot,
    applied: bool,
    removal: Option<RemovalResult>,
    edit_token: Option<u64>,
}

mod audio;
pub(crate) mod runtime;
pub(crate) use runtime::{initialize, synchronize_removal, system_command};
#[cfg(test)]
use runtime::{run_worker, system_operation, PlaybackSession};

pub struct Session<A: SessionAudio> {
    pub queue: Queue,
    current_track: Option<ListeningTrack>,
    playback_id: Option<u64>,
    audio: A,
    generation: Arc<AtomicU64>,
    revision: u64,
    preparation_revision: u64,
    preparation_dirty: bool,
    prepared: Option<(u64, String)>,
    preparation_signature: Option<(u64, Vec<String>)>,
    handled_end: Option<u64>,
    editing: Option<u64>,
    seeking: bool,
    command_pending: bool,
    volume: VolumePreferences,
    queue_errors: Vec<String>,
    playback_error: String,
    skipped: HashSet<i64>,
}

impl<A: SessionAudio> Session<A> {
    pub fn new(mut audio: A, mut saved: SavedSession, generation: Arc<AtomicU64>) -> Self {
        saved.queue.restore();
        let playback_error = audio
            .set_volume(saved.volume.volume)
            .err()
            .unwrap_or_default();
        let skipped = audio.skipped();
        Self {
            queue: saved.queue,
            current_track: saved.current_track,
            playback_id: None,
            audio,
            generation,
            revision: 0,
            preparation_revision: 0,
            preparation_dirty: true,
            prepared: None,
            preparation_signature: None,
            handled_end: None,
            editing: None,
            seeking: false,
            command_pending: false,
            volume: saved.volume,
            queue_errors: Vec::new(),
            playback_error,
            skipped,
        }
    }

    fn saved(&self) -> SavedSession {
        SavedSession {
            queue: self.queue.clone(),
            current_track: self.current_track.clone(),
            volume: self.volume.clone(),
        }
    }

    fn snapshot(&self) -> Result<SessionSnapshot, String> {
        let mut skipped_track_ids: Vec<_> = self.skipped.iter().copied().collect();
        skipped_track_ids.sort_unstable();
        Ok(SessionSnapshot {
            revision: self.revision,
            displayed_tracks: self.queue.displayed_tracks.clone(),
            current_row_key: self.queue.current_row_key.clone(),
            current_track: self.current_track.clone(),
            current_playback_id: self.playback_id,
            playback_status: self.audio.status()?,
            queue_playback_error: self.queue_errors.join("\n"),
            playback_error: self.playback_error.clone(),
            shuffle_enabled: self.queue.shuffle_enabled,
            repeat_one_enabled: self.queue.repeat_one_enabled,
            can_play_previous: !self.queue.candidates(true, false, &self.skipped).is_empty(),
            can_play_next: !self
                .queue
                .candidates(false, false, &self.skipped)
                .is_empty(),
            skipped_track_ids,
            volume: self.volume.volume,
            is_editing: self.editing.is_some(),
            is_command_pending: self.command_pending,
        })
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }

    fn start_candidates(
        &mut self,
        candidates: Vec<QueueTrack>,
        generation: u64,
        allow_first_skipped: bool,
        previous: bool,
    ) -> Result<bool, String> {
        for (index, item) in candidates.iter().enumerate() {
            if !self.is_current(generation) {
                return Ok(false);
            }
            if !(index == 0 && allow_first_skipped) && self.audio.skipped().contains(&item.track_id)
            {
                continue;
            }
            self.audio.set_volume(self.volume.volume)?;
            match self.audio.start(item.track_id, &item.row_key) {
                Ok(track) => {
                    if !self.is_current(generation)
                        || (!(index == 0 && allow_first_skipped)
                            && self.audio.skipped().contains(&item.track_id))
                    {
                        self.audio.stop(track.playback_id)?;
                        if !self.is_current(generation) {
                            return Ok(false);
                        }
                        continue;
                    }
                    self.current_track = Some(ListeningTrack::from(&track));
                    self.playback_id = Some(track.playback_id);
                    self.handled_end = None;
                    self.prepared = None;
                    self.preparation_signature = None;
                    self.preparation_dirty = true;
                    self.queue.commit(&item.row_key, previous);
                    self.playback_error.clear();
                    return Ok(true);
                }
                Err(error) => {
                    if !self.is_current(generation) {
                        return Ok(false);
                    }
                    self.queue_errors.push(format!(
                        "{}: {error}",
                        item.title.as_deref().unwrap_or("Unknown track")
                    ));
                }
            }
        }
        Ok(false)
    }

    fn cancel_preparation(&mut self) -> Result<(), String> {
        self.prepared = None;
        self.preparation_signature = None;
        self.preparation_dirty = true;
        if let Some(id) = self.playback_id {
            self.preparation_revision += 1;
            self.audio.prepare(id, self.preparation_revision, None)?;
        }
        Ok(())
    }

    fn prepare_next(&mut self) -> Result<(), String> {
        if self.editing.is_some() || self.seeking || !self.preparation_dirty {
            return Ok(());
        }
        self.preparation_dirty = false;
        let Some(id) = self.playback_id else {
            return Ok(());
        };
        let candidates = if self.handled_end == Some(id) {
            Vec::new()
        } else {
            self.queue.candidates(false, true, &self.skipped)
        };
        let signature = (
            id,
            candidates
                .iter()
                .map(|track| track.row_key.clone())
                .collect::<Vec<_>>(),
        );
        if self.preparation_signature.as_ref() == Some(&signature) {
            return Ok(());
        }
        self.preparation_signature = Some(signature);
        if self.prepared.as_ref().is_some_and(|(prepared_id, key)| {
            *prepared_id == id
                && candidates
                    .first()
                    .is_some_and(|track| &track.row_key == key)
        }) {
            return Ok(());
        }
        self.prepared = None;
        if candidates.is_empty() {
            self.preparation_revision += 1;
            self.audio.prepare(id, self.preparation_revision, None)?;
        } else {
            let generation = self.generation.load(Ordering::SeqCst);
            for item in candidates {
                self.preparation_revision += 1;
                match self
                    .audio
                    .prepare(id, self.preparation_revision, Some(&item))
                {
                    Ok(true) => {
                        if !self.is_current(generation) {
                            self.cancel_preparation()?;
                            return Ok(());
                        }
                        self.prepared = Some((id, item.row_key));
                        return Ok(());
                    }
                    Ok(false) => return Ok(()),
                    Err(error) => self.queue_errors.push(format!(
                        "{}: {error}",
                        item.title.as_deref().unwrap_or("Unknown track")
                    )),
                }
            }
        }
        Ok(())
    }

    fn refresh_skipped(&mut self) -> bool {
        let skipped = self.audio.skipped();
        if skipped == self.skipped {
            return false;
        }
        self.skipped = skipped;
        self.preparation_dirty = true;
        true
    }

    fn reconcile(&mut self) -> Result<bool, String> {
        let status = self.audio.status()?;
        let Some(track) = status.now_playing else {
            return Ok(false);
        };
        if self.playback_id == Some(track.playback_id) {
            return Ok(false);
        }
        if track.previous_playback_id != self.playback_id {
            return Ok(false);
        }
        let Some(key) = track.row_key.as_ref() else {
            return Ok(false);
        };
        if !self
            .queue
            .find(key)
            .is_some_and(|item| item.track_id == track.track_id)
        {
            return Ok(false);
        }
        self.queue.commit(key, false);
        self.current_track = Some(ListeningTrack::from(&track));
        self.playback_id = Some(track.playback_id);
        self.handled_end = None;
        self.prepared = None;
        self.preparation_signature = None;
        self.preparation_dirty = true;
        Ok(true)
    }

    pub fn tick(&mut self) -> Result<bool, String> {
        let mut changed = self.reconcile()?;
        changed |= self.refresh_skipped();
        if self.editing.is_some() || self.seeking {
            return Ok(changed);
        }
        let status = self.audio.status()?;
        if status.has_ended
            && status.playback_id == self.playback_id
            && self.handled_end != self.playback_id
        {
            let generation = self.generation.load(Ordering::SeqCst);
            self.handled_end = self.playback_id;
            let candidates = self.queue.candidates(false, true, &self.skipped);
            self.cancel_preparation()?;
            if !self.start_candidates(candidates, generation, false, false)?
                && self.is_current(generation)
            {
                self.audio.pause()?;
                if self.is_current(generation) {
                    self.audio.seek(0)?;
                }
            }
            changed = true;
        }
        let errors = self.queue_errors.len();
        self.prepare_next()?;
        Ok(changed || errors != self.queue_errors.len())
    }

    fn remove(&mut self, keys: HashSet<String>, generation: u64) -> Result<RemovalResult, String> {
        if !self
            .queue
            .displayed_tracks
            .iter()
            .any(|track| keys.contains(&track.row_key))
        {
            return Ok(RemovalResult::NotFound);
        }
        let candidates = self
            .queue
            .candidates(false, false, &self.skipped)
            .into_iter()
            .filter(|track| !keys.contains(&track.row_key))
            .collect();
        self.cancel_preparation()?;
        let removed_current = self.queue.remove(&keys);
        self.queue_errors.clear();
        if removed_current {
            if let Some(id) = self.playback_id.take() {
                self.current_track = None;
                match self.audio.stop(id) {
                    Err(message) => return Ok(RemovalResult::StopFailed { message }),
                    Ok(false) => return Ok(RemovalResult::StopUnconfirmed),
                    Ok(true) => {}
                }
            }
            self.current_track = None;
            if !self.is_current(generation) {
                return Ok(RemovalResult::Superseded);
            }
            self.start_candidates(candidates, generation, false, false)?;
        }
        Ok(if self.is_current(generation) {
            RemovalResult::Removed
        } else {
            RemovalResult::Superseded
        })
    }

    fn execute(
        &mut self,
        command: SessionCommand,
        generation: u64,
    ) -> Result<(bool, Option<RemovalResult>, Option<u64>), String> {
        if (command.invalidates() || matches!(command, SessionCommand::Seek { .. }))
            && !self.is_current(generation)
        {
            return Ok((false, Some(RemovalResult::Superseded), None));
        }
        if let SessionCommand::System { operation } = command {
            if self.editing.is_some() || self.seeking {
                return Ok((false, None, None));
            }
            return self.execute(operation.command(), generation);
        }
        if self.editing.is_some()
            && !matches!(
                command,
                SessionCommand::Snapshot
                    | SessionCommand::EndEditing { .. }
                    | SessionCommand::UpdateMetadata { .. }
            )
        {
            return Err("Playback file editing is in progress".into());
        }
        if command.invalidates()
            && !matches!(
                command,
                SessionCommand::BeginSeeking | SessionCommand::Seek { .. }
            )
        {
            self.seeking = false;
        }
        self.skipped = self.audio.skipped();
        if !matches!(
            command,
            SessionCommand::Volume { .. } | SessionCommand::Mute | SessionCommand::Snapshot
        ) {
            self.preparation_dirty = true;
        }
        let mut applied = true;
        let mut removal = None;
        let mut edit_token = None;
        match command {
            SessionCommand::System { .. } => unreachable!(),
            SessionCommand::Snapshot => {}
            SessionCommand::PlayTracks {
                tracks,
                start_row_key,
                allow_skipped,
            } => {
                let mut queue = Queue::with_tracks(tracks);
                queue.validate()?;
                if queue.find(&start_row_key).is_none() {
                    return Ok((false, None, None));
                }
                queue.shuffle_enabled = self.queue.shuffle_enabled;
                queue.repeat_one_enabled = self.queue.repeat_one_enabled;
                queue.start_round(&start_row_key);
                self.handled_end = self.playback_id;
                self.cancel_preparation()?;
                let old_queue = std::mem::replace(&mut self.queue, queue);
                let mut candidates = self
                    .queue
                    .current()
                    .cloned()
                    .into_iter()
                    .collect::<Vec<_>>();
                candidates.extend(self.queue.candidates(false, false, &self.skipped));
                self.queue_errors.clear();
                applied = self.start_candidates(candidates, generation, allow_skipped, false)?;
                if !applied {
                    if self
                        .queue
                        .displayed_tracks
                        .iter()
                        .all(|track| self.skipped.contains(&track.track_id))
                    {
                        if let Some(id) = self.playback_id.take() {
                            self.audio.stop(id)?;
                        }
                        self.current_track = None;
                        self.queue.current_row_key = None;
                    } else {
                        self.queue = old_queue;
                    }
                }
            }
            SessionCommand::PlayItem { row_key } => {
                if self.queue.find(&row_key).is_none() {
                    return Ok((false, None, None));
                }
                self.handled_end = self.playback_id;
                self.cancel_preparation()?;
                let old_queue = self.queue.clone();
                self.queue.start_round(&row_key);
                let mut candidates = self
                    .queue
                    .current()
                    .cloned()
                    .into_iter()
                    .collect::<Vec<_>>();
                candidates.extend(self.queue.candidates(false, false, &self.skipped));
                self.queue_errors.clear();
                applied = self.start_candidates(candidates, generation, true, false)?;
                if !applied {
                    self.queue = old_queue;
                }
            }
            SessionCommand::Previous | SessionCommand::Next => {
                let previous = matches!(command, SessionCommand::Previous);
                let candidates = self.queue.candidates(previous, false, &self.skipped);
                if candidates.is_empty() {
                    return Ok((false, None, None));
                }
                self.handled_end = self.playback_id;
                self.cancel_preparation()?;
                self.queue_errors.clear();
                applied = self.start_candidates(candidates, generation, false, previous)?;
                if !applied && !previous && self.is_current(generation) {
                    if let Some(id) = self.playback_id.take() {
                        self.audio.stop(id)?;
                    }
                    self.current_track = None;
                    self.queue.current_row_key = None;
                }
            }
            SessionCommand::Toggle | SessionCommand::Play | SessionCommand::Pause => {
                let status = self.audio.status()?;
                let should_play = match command {
                    SessionCommand::Play => true,
                    SessionCommand::Pause => false,
                    _ => !status.is_playing,
                };
                if !should_play {
                    self.handled_end = self.playback_id;
                    self.cancel_preparation()?;
                }
                if should_play != status.is_playing {
                    if should_play && (!status.has_audio || status.has_ended) {
                        let candidates = self
                            .queue
                            .current()
                            .filter(|track| !self.skipped.contains(&track.track_id))
                            .cloned()
                            .into_iter()
                            .chain(self.queue.candidates(false, false, &self.skipped))
                            .collect();
                        applied = self.start_candidates(candidates, generation, false, false)?;
                    } else if status.has_audio {
                        if should_play {
                            self.handled_end = None;
                            self.audio.resume()?;
                        } else {
                            self.cancel_preparation()?;
                            self.handled_end = self.playback_id;
                            self.audio.pause()?;
                        }
                    } else {
                        applied = false;
                    }
                }
            }
            SessionCommand::Volume { volume } => {
                if volume > 100 {
                    return Err("Volume must be between 0 and 100".into());
                }
                self.audio.set_volume(volume)?;
                self.volume.volume = volume;
                self.playback_error.clear();
                if volume > 0 {
                    self.volume.last_non_muted_volume = volume;
                }
            }
            SessionCommand::Mute => {
                let volume = if self.volume.volume == 0 {
                    self.volume.last_non_muted_volume
                } else {
                    0
                };
                self.audio.set_volume(volume)?;
                self.volume.volume = volume;
                self.playback_error.clear();
            }
            SessionCommand::BeginSeeking => {
                self.seeking = true;
                self.cancel_preparation()?;
            }
            SessionCommand::Seek {
                position_ms,
                playback_id,
            } => {
                self.seeking = false;
                applied = playback_id.is_some() && playback_id == self.playback_id;
                if applied {
                    self.audio.seek(position_ms)?;
                    self.handled_end = None;
                }
            }
            SessionCommand::Add { tracks, next } => {
                if tracks.iter().any(|track| {
                    track.track_id <= 0
                        || track.track_id > MAX_SAFE_INTEGER
                        || track
                            .duration_ms
                            .is_some_and(|duration| duration > MAX_SAFE_INTEGER as u64)
                }) {
                    return Err("Invalid queue track IDs".into());
                }
                applied = self.queue.add(tracks, next);
            }
            SessionCommand::Remove { row_keys } => {
                removal = Some(self.remove(row_keys.into_iter().collect(), generation)?);
            }
            SessionCommand::RemoveTrack { track_id } => {
                let keys = self
                    .queue
                    .displayed_tracks
                    .iter()
                    .filter(|track| track.track_id == track_id)
                    .map(|track| track.row_key.clone())
                    .collect();
                removal = Some(self.remove(keys, generation)?);
            }
            SessionCommand::Clear => {
                self.cancel_preparation()?;
                self.queue = Queue::default();
                self.current_track = None;
                self.queue_errors.clear();
                removal = Some(if let Some(id) = self.playback_id.take() {
                    match self.audio.stop(id) {
                        Ok(true) => RemovalResult::Removed,
                        Ok(false) => RemovalResult::StopUnconfirmed,
                        Err(message) => RemovalResult::StopFailed { message },
                    }
                } else {
                    RemovalResult::Removed
                });
            }
            SessionCommand::Repeat { enabled } => {
                self.queue.repeat_one_enabled = enabled;
            }
            SessionCommand::Shuffle { enabled } => {
                self.queue.set_shuffle(enabled);
            }
            SessionCommand::BeginEditing { track_ids } => {
                if track_ids.iter().any(|id| *id <= 0) {
                    return Err("Invalid editing track IDs".into());
                }
                self.cancel_preparation()?;
                {
                    // Reconcile once more after cancelling the prepared decoder, since the
                    // audio thread may have crossed the boundary during that cancellation.
                    self.reconcile()?;
                    if self
                        .current_track
                        .as_ref()
                        .is_some_and(|track| track_ids.contains(&track.track_id))
                    {
                        if let Some(id) = self.playback_id {
                            if !self.audio.stop(id)? {
                                return Err("Could not confirm playback file release".into());
                            }
                            self.playback_id = None;
                        }
                    }
                }
                self.editing = Some(generation);
                edit_token = Some(generation);
            }
            SessionCommand::EndEditing { token } => {
                if self.editing != Some(token) {
                    return Err("Invalid playback editing token".into());
                }
                self.editing = None;
                self.preparation_signature = None;
            }
            SessionCommand::UpdateMetadata { tracks } => {
                for update in tracks {
                    for track in self
                        .queue
                        .displayed_tracks
                        .iter_mut()
                        .filter(|track| track.track_id == update.id)
                    {
                        track.title = update.title.clone();
                        track.album = update.album.clone();
                        track.duration_ms = update.duration_ms;
                    }
                    if let Some(track) = self
                        .current_track
                        .as_mut()
                        .filter(|track| track.track_id == update.id)
                    {
                        track.title = update.title;
                        track.artist = update.artist;
                    }
                }
            }
        }
        // Metadata editing releases the current file and keeps the listening selection;
        // ending the edit never restarts audio automatically.
        self.prepare_next()?;
        Ok((applied, removal, edit_token))
    }
}

#[cfg(test)]
#[path = "tests/session.rs"]
mod tests;
#[cfg(test)]
pub(crate) use tests::initialize_test_session;
