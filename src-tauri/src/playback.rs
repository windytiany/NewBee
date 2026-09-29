use crate::database::Database;
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

pub struct PlaybackState {
    active: Mutex<Option<ActivePlayback>>,
    volume: Mutex<u8>,
    next_playback_id: AtomicU64,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            volume: Mutex::new(100),
            next_playback_id: AtomicU64::new(0),
        }
    }
}

struct ActivePlayback {
    playback_id: u64,
    player: Player,
    _output: MixerDeviceSink,
    path: PathBuf,
    duration: Duration,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    has_audio: bool,
    is_playing: bool,
    has_ended: bool,
    playback_id: Option<u64>,
    position_ms: u64,
    duration_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingTrack {
    track_id: i64,
    playback_id: u64,
    title: Option<String>,
    artist: Option<String>,
}

const AUDIO_FILE_NOT_FOUND_PREFIX: &str = "AUDIO_FILE_NOT_FOUND:";

enum PlaybackError {
    AudioFileNotFound(String),
    Other(String),
}

impl PlaybackError {
    fn into_message(self) -> String {
        match self {
            Self::AudioFileNotFound(message) | Self::Other(message) => message,
        }
    }

    fn into_play_command_message(self) -> String {
        match self {
            Self::AudioFileNotFound(message) => {
                format!("{AUDIO_FILE_NOT_FOUND_PREFIX} {message}")
            }
            Self::Other(message) => message,
        }
    }
}

#[tauri::command]
pub fn play_track(
    track_id: i64,
    database: State<'_, Database>,
    state: State<'_, PlaybackState>,
) -> Result<NowPlayingTrack, String> {
    let track = database
        .get_track_for_playback(track_id)?
        .ok_or_else(|| format!("Track {track_id} was not found"))?;
    let playback_id = start_playback(Path::new(&track.path), &state)
        .map_err(PlaybackError::into_play_command_message)?;

    Ok(NowPlayingTrack {
        track_id,
        playback_id,
        title: track.title,
        artist: track.artist,
    })
}

#[tauri::command]
pub fn set_volume(volume: u8, state: State<'_, PlaybackState>) -> Result<(), String> {
    if volume > 100 {
        return Err("Volume must be between 0 and 100".to_owned());
    }

    let mut current_volume = state
        .volume
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    *current_volume = volume;

    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    if let Some(playback) = active.as_ref() {
        playback.player.set_volume(volume as f32 / 100.0);
    }

    Ok(())
}

#[tauri::command]
pub fn pause(state: State<'_, PlaybackState>) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_ref()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    playback.player.pause();
    Ok(())
}

#[tauri::command]
pub fn resume(state: State<'_, PlaybackState>) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_ref()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    playback.player.play();
    Ok(())
}

#[tauri::command]
pub fn stop_playback(playback_id: u64, state: State<'_, PlaybackState>) -> Result<bool, String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let active_playback_id = active.as_ref().map(|playback| playback.playback_id);
    if !is_expected_playback_id(active_playback_id, playback_id) {
        return Ok(false);
    }

    let Some(playback) = active.take() else {
        return Ok(false);
    };
    playback.player.stop();
    Ok(true)
}

#[tauri::command]
pub fn seek_to(position_ms: u64, state: State<'_, PlaybackState>) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_mut()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    let position = Duration::from_millis(position_ms.min(duration_ms(playback.duration)));

    if playback.player.empty() {
        reload_source_at_position(playback, position)?;
    } else {
        playback
            .player
            .try_seek(position)
            .map_err(|error| format!("Could not seek in audio: {error}"))?;
        if playback.player.empty() && position < playback.duration {
            reload_source_at_position(playback, position)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn playback_status(state: State<'_, PlaybackState>) -> Result<PlaybackStatus, String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;

    let Some(playback) = active.as_ref() else {
        return Ok(PlaybackStatus {
            has_audio: false,
            is_playing: false,
            has_ended: false,
            playback_id: None,
            position_ms: 0,
            duration_ms: 0,
        });
    };

    let has_finished = playback.player.empty();
    let position = if has_finished {
        playback.duration
    } else {
        playback.player.get_pos().min(playback.duration)
    };
    let has_ended = playback_has_ended(has_finished, position, playback.duration);

    Ok(PlaybackStatus {
        has_audio: true,
        is_playing: !playback.player.is_paused() && !has_ended,
        has_ended,
        playback_id: Some(playback.playback_id),
        position_ms: duration_ms(position),
        duration_ms: duration_ms(playback.duration),
    })
}

fn start_playback(path: &Path, state: &PlaybackState) -> Result<u64, PlaybackError> {
    let path = path.to_path_buf();
    let source = open_decoder(&path)?;
    let duration = source
        .total_duration()
        .ok_or_else(|| PlaybackError::Other("Could not determine audio duration".to_owned()))?;

    let output = DeviceSinkBuilder::open_default_sink()
        .map_err(|error| PlaybackError::Other(format!("Could not open audio output: {error}")))?;
    let volume = state
        .volume
        .lock()
        .map_err(|_| PlaybackError::Other("Playback state is unavailable".to_owned()))?;
    let mut active = state
        .active
        .lock()
        .map_err(|_| PlaybackError::Other("Playback state is unavailable".to_owned()))?;
    active.take();

    let playback_id = state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let player = Player::connect_new(output.mixer());
    player.set_volume(*volume as f32 / 100.0);
    player.append(source);
    *active = Some(ActivePlayback {
        playback_id,
        player,
        _output: output,
        path,
        duration,
    });

    Ok(playback_id)
}

fn reload_source_at_position(
    playback: &mut ActivePlayback,
    position: Duration,
) -> Result<(), String> {
    let source = open_decoder(&playback.path).map_err(PlaybackError::into_message)?;
    playback.player.clear();
    playback.player.append(source);
    playback
        .player
        .try_seek(position)
        .map_err(|error| format!("Could not seek in audio: {error}"))?;
    Ok(())
}

fn open_decoder(path: &Path) -> Result<Decoder<BufReader<File>>, PlaybackError> {
    let file = File::open(path).map_err(|error| {
        let message = format!("Could not open audio file '{}': {error}", path.display());
        if error.kind() == ErrorKind::NotFound {
            PlaybackError::AudioFileNotFound(message)
        } else {
            PlaybackError::Other(message)
        }
    })?;
    Decoder::try_from(file).map_err(|error| {
        PlaybackError::Other(format!(
            "Could not decode audio file '{}': {error}",
            path.display()
        ))
    })
}

fn is_expected_playback_id(active_playback_id: Option<u64>, expected_playback_id: u64) -> bool {
    active_playback_id == Some(expected_playback_id)
}

fn playback_has_ended(is_empty: bool, position: Duration, duration: Duration) -> bool {
    is_empty || duration_ms(position) >= duration_ms(duration)
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::{
        is_expected_playback_id, open_decoder, playback_has_ended, PlaybackError,
        AUDIO_FILE_NOT_FOUND_PREFIX,
    };
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn a_stop_request_only_matches_its_playback_instance() {
        assert!(is_expected_playback_id(Some(12), 12));
        assert!(!is_expected_playback_id(Some(13), 12));
        assert!(!is_expected_playback_id(None, 12));
    }

    #[test]
    fn reaching_track_duration_counts_as_ended_before_player_queue_drains() {
        let duration = Duration::from_secs(30) + Duration::from_micros(500);
        let seek_position = Duration::from_millis(super::duration_ms(duration));

        assert!(seek_position < duration);
        assert!(playback_has_ended(false, seek_position, duration));
        assert!(!playback_has_ended(
            false,
            seek_position - Duration::from_millis(1),
            duration
        ));
        assert!(playback_has_ended(true, Duration::ZERO, duration));
    }

    #[test]
    fn missing_audio_file_has_a_distinct_startup_error() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let path = std::env::temp_dir().join(format!("newbee-missing-{unique}.mp3"));
        let message = match open_decoder(&path) {
            Err(error) => error.into_play_command_message(),
            Ok(_) => panic!("the test audio file unexpectedly exists"),
        };

        assert!(message.starts_with(AUDIO_FILE_NOT_FOUND_PREFIX));
        assert!(message.contains("Could not open audio file"));
    }

    #[test]
    fn non_file_errors_are_not_classified_as_missing_audio() {
        let message = PlaybackError::Other("Could not open audio output: unavailable".to_owned())
            .into_play_command_message();

        assert!(!message.starts_with(AUDIO_FILE_NOT_FOUND_PREFIX));
        assert!(message.contains("Could not open audio output"));
    }
}
