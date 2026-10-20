use super::{NowPlayingTrack, PlaybackStatus, QueueTrack};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListeningTrack {
    pub track_id: Option<i64>,
    #[serde(default)]
    pub path: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
}

impl From<&NowPlayingTrack> for ListeningTrack {
    fn from(track: &NowPlayingTrack) -> Self {
        Self {
            track_id: track.track_id,
            path: track.path.clone(),
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
        start_row_key: Option<String>,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataUpdate {
    pub(super) id: i64,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) duration_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemOperation {
    Play,
    Pause,
    Toggle,
    Previous,
    Next,
    SeekBackward,
    SeekForward,
    VolumeDown,
    VolumeUp,
    Mute,
    Shuffle,
    Repeat,
}

impl SessionCommand {
    pub(super) fn invalidates(&self) -> bool {
        if let Self::System { operation } = self {
            return !matches!(
                operation,
                SystemOperation::VolumeDown
                    | SystemOperation::VolumeUp
                    | SystemOperation::Mute
                    | SystemOperation::Shuffle
                    | SystemOperation::Repeat
            );
        }
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
    pub structural_revision: u64,
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
    StopUnconfirmed,
    Superseded,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionReply {
    pub(super) snapshot: SessionSnapshot,
    pub(super) applied: bool,
    pub(super) removal: Option<RemovalResult>,
    pub(super) edit_token: Option<u64>,
}
