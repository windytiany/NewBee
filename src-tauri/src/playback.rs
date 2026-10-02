mod continuous;

use crate::database::Database;
use continuous::{ContinuousPlayback, ContinuousSource, PreparedTrack};
use rodio::source::UniformSourceIterator;
use rodio::{
    ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate, Source,
};
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, ErrorKind};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, State};

pub struct PlaybackState {
    active: Mutex<Option<ActivePlayback>>,
    output: Mutex<Option<MixerDeviceSink>>,
    volume: Mutex<u8>,
    next_playback_id: AtomicU64,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            output: Mutex::new(None),
            volume: Mutex::new(100),
            next_playback_id: AtomicU64::new(0),
        }
    }
}

struct ActivePlayback {
    player: Player,
    continuous: ContinuousPlayback,
    channels: ChannelCount,
    sample_rate: SampleRate,
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
    now_playing: Option<NowPlayingTrack>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingTrack {
    track_id: i64,
    playback_id: u64,
    title: Option<String>,
    artist: Option<String>,
    row_key: Option<String>,
    previous_playback_id: Option<u64>,
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
    _app: tauri::AppHandle,
    track_id: i64,
    row_key: Option<String>,
    database: State<'_, Database>,
    state: State<'_, PlaybackState>,
) -> Result<NowPlayingTrack, String> {
    let track = database
        .get_track_for_playback(track_id)?
        .ok_or_else(|| format!("Track {track_id} was not found"))?;
    let now_playing = NowPlayingTrack {
        track_id,
        playback_id: state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1,
        title: track.title.clone(),
        artist: track.artist.clone(),
        row_key,
        previous_playback_id: None,
    };
    let prepared = prepare_track(Path::new(&track.path), now_playing.clone())
        .map_err(PlaybackError::into_play_command_message)?;
    start_playback(prepared, &state, &_app).map_err(PlaybackError::into_message)?;

    #[cfg(windows)]
    {
        let active = state
            .active
            .lock()
            .map_err(|_| "Playback state is unavailable".to_owned())?;
        if active.as_ref().is_some_and(|playback| {
            playback.continuous.snapshot().track.playback_id == now_playing.playback_id
        }) {
            let fallback_title = Path::new(&track.path)
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            crate::system_media::set_track(
                &_app,
                &database,
                track_id,
                track.title.as_deref().unwrap_or(fallback_title),
                track.artist.as_deref().unwrap_or(""),
            );
        }
    }

    Ok(now_playing)
}

#[tauri::command]
pub async fn prepare_next_track(
    playback_id: u64,
    revision: u64,
    track_id: Option<i64>,
    row_key: Option<String>,
    database: State<'_, Database>,
    state: State<'_, PlaybackState>,
) -> Result<bool, String> {
    let (continuous, channels, sample_rate) = {
        let active = state
            .active
            .lock()
            .map_err(|_| "Playback state is unavailable")?;
        let Some(active) = active.as_ref() else {
            return Ok(false);
        };
        if !active.continuous.reserve(playback_id, revision) {
            return Ok(false);
        }
        (
            active.continuous.clone(),
            active.channels,
            active.sample_rate,
        )
    };
    let Some(track_id) = track_id else {
        return Ok(true);
    };
    let track = database
        .get_track_for_playback(track_id)?
        .ok_or_else(|| format!("Track {track_id} was not found"))?;
    let now_playing = NowPlayingTrack {
        track_id,
        playback_id: state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1,
        title: track.title,
        artist: track.artist,
        row_key,
        previous_playback_id: Some(playback_id),
    };
    let next = tauri::async_runtime::spawn_blocking(move || {
        prepare_track(Path::new(&track.path), now_playing)
            .map(|track| normalize_track(track, channels, sample_rate))
            .map_err(PlaybackError::into_play_command_message)
    })
    .await
    .map_err(|error| format!("Could not prepare next track: {error}"))??;
    Ok(continuous.prepare(playback_id, revision, next))
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
pub fn pause(_app: tauri::AppHandle, state: State<'_, PlaybackState>) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_ref()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    playback.player.pause();
    #[cfg(windows)]
    crate::system_media::set_playback(&_app, true, false);
    Ok(())
}

#[tauri::command]
pub fn resume(_app: tauri::AppHandle, state: State<'_, PlaybackState>) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_ref()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    playback.player.play();
    #[cfg(windows)]
    crate::system_media::set_playback(&_app, true, !playback.continuous.snapshot().ended);
    Ok(())
}

#[tauri::command]
pub fn stop_playback(
    _app: tauri::AppHandle,
    playback_id: u64,
    state: State<'_, PlaybackState>,
) -> Result<bool, String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let active_playback_id = active
        .as_ref()
        .map(|playback| playback.continuous.snapshot().track.playback_id);
    if !is_expected_playback_id(active_playback_id, playback_id) {
        return Ok(false);
    }

    let Some(playback) = active.take() else {
        return Ok(false);
    };
    playback.player.stop();
    #[cfg(windows)]
    crate::system_media::set_playback(&_app, false, false);
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
    let snapshot = playback.continuous.snapshot();
    let position = Duration::from_millis(position_ms.min(duration_ms(snapshot.duration)));
    playback
        .player
        .try_seek(position)
        .map_err(|error| format!("Could not seek in audio: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn playback_status(
    _app: tauri::AppHandle,
    state: State<'_, PlaybackState>,
) -> Result<PlaybackStatus, String> {
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
            now_playing: None,
        });
    };

    let snapshot = playback.continuous.snapshot();
    let has_ended = snapshot.ended;
    #[cfg(windows)]
    crate::system_media::set_playback(&_app, true, !playback.player.is_paused() && !has_ended);

    Ok(PlaybackStatus {
        has_audio: true,
        is_playing: !playback.player.is_paused() && !has_ended,
        has_ended,
        playback_id: Some(snapshot.track.playback_id),
        position_ms: duration_ms(snapshot.position),
        duration_ms: duration_ms(snapshot.duration),
        now_playing: Some(snapshot.track),
    })
}

fn prepare_track(path: &Path, track: NowPlayingTrack) -> Result<PreparedTrack, PlaybackError> {
    let source = open_decoder(path)?;
    let duration = source
        .total_duration()
        .ok_or_else(|| PlaybackError::Other("Could not determine audio duration".to_owned()))?;
    Ok(PreparedTrack {
        track,
        duration,
        source: Box::new(source),
    })
}

fn normalize_track(
    mut track: PreparedTrack,
    channels: ChannelCount,
    sample_rate: SampleRate,
) -> PreparedTrack {
    track.source = Box::new(UniformSourceIterator::new(
        track.source,
        channels,
        sample_rate,
    ));
    track
}

fn start_playback(
    prepared: PreparedTrack,
    state: &PlaybackState,
    app: &tauri::AppHandle,
) -> Result<(), PlaybackError> {
    let unavailable = || PlaybackError::Other("Playback state is unavailable".to_owned());
    let mut output = state.output.lock().map_err(|_| unavailable())?;
    if output.is_none() {
        *output = Some(DeviceSinkBuilder::open_default_sink().map_err(|error| {
            PlaybackError::Other(format!("Could not open audio output: {error}"))
        })?);
    }
    let output = output.as_ref().unwrap();
    let channels = output.config().channel_count();
    let sample_rate = output.config().sample_rate();
    let volume = state.volume.lock().map_err(|_| unavailable())?;
    let mut active = state.active.lock().map_err(|_| unavailable())?;
    if let Some(old) = active.take() {
        old.player.stop();
    }
    let (source, continuous, transitions) = ContinuousSource::new(
        normalize_track(prepared, channels, sample_rate),
        app.state::<Database>().skipped_tracks(),
    );
    let app = app.clone();
    std::thread::spawn(move || {
        while let Ok(track) = transitions.recv() {
            let state = app.state::<PlaybackState>();
            let Ok(active) = state.active.lock() else {
                break;
            };
            if !active.as_ref().is_some_and(|active| {
                active.continuous.snapshot().track.playback_id == track.playback_id
            }) {
                continue;
            }
            #[cfg(windows)]
            crate::system_media::set_track(
                &app,
                &app.state::<Database>(),
                track.track_id,
                track.title.as_deref().unwrap_or(""),
                track.artist.as_deref().unwrap_or(""),
            );
            if let Err(error) = app.emit("playback-track-started", &track) {
                eprintln!("Could not notify track transition: {error}");
            }
        }
    });
    let player = connect_source(output.mixer(), source, *volume as f32 / 100.0);
    *active = Some(ActivePlayback {
        player,
        continuous,
        channels,
        sample_rate,
    });
    Ok(())
}

fn connect_source(mixer: &rodio::mixer::Mixer, source: ContinuousSource, volume: f32) -> Player {
    let (player, queue) = Player::new();
    player.set_volume(volume);
    // The mixer must see the real channel count/rate, not an initially empty Player.
    player.append(source);
    mixer.add(queue);
    player
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

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::{
        is_expected_playback_id, open_decoder, PlaybackError, AUDIO_FILE_NOT_FOUND_PREFIX,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn a_stop_request_only_matches_its_playback_instance() {
        assert!(is_expected_playback_id(Some(12), 12));
        assert!(!is_expected_playback_id(Some(13), 12));
        assert!(!is_expected_playback_id(None, 12));
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
