mod continuous;
#[cfg(windows)]
pub(crate) mod media;
mod persistence;
mod queue;
pub(crate) mod session;
mod session_audio;
mod spectrum;

use crate::database::Database;
use continuous::{ContinuousPlayback, ContinuousSource, PreparedTrack};
use rodio::source::UniformSourceIterator;
use rodio::{
    ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate, Source,
};
use serde::Serialize;
use spectrum::{SpectrumCapture, SpectrumSource, BAND_COUNT};
use std::fs::File;
use std::io::{BufReader, ErrorKind};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, State};

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
    spectrum: Arc<SpectrumCapture>,
    continuous: ContinuousPlayback,
    channels: ChannelCount,
    sample_rate: SampleRate,
}

#[derive(Clone, Serialize)]
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

pub(crate) fn play_track(
    _app: &tauri::AppHandle,
    track_id: i64,
    row_key: Option<String>,
    database: &Database,
    state: &PlaybackState,
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
    start_playback(prepared, state, _app).map_err(PlaybackError::into_message)?;

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
            media::set_track(
                _app,
                database,
                track_id,
                track.title.as_deref().unwrap_or(fallback_title),
                track.artist.as_deref().unwrap_or(""),
            );
        }
    }

    Ok(now_playing)
}

pub(crate) fn prepare_next_track(
    playback_id: u64,
    revision: u64,
    track_id: Option<i64>,
    row_key: Option<String>,
    database: &Database,
    state: &PlaybackState,
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
    let next = prepare_track(Path::new(&track.path), now_playing)
        .map(|track| normalize_track(track, channels, sample_rate))
        .map_err(PlaybackError::into_play_command_message)?;
    Ok(continuous.prepare(playback_id, revision, next))
}

pub(crate) fn set_volume(volume: u8, state: &PlaybackState) -> Result<(), String> {
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

pub(crate) fn pause(_app: &tauri::AppHandle, state: &PlaybackState) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_ref()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    playback.player.pause();
    #[cfg(windows)]
    media::set_playback(_app, true, false);
    Ok(())
}

pub(crate) fn resume(_app: &tauri::AppHandle, state: &PlaybackState) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_ref()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    playback.player.play();
    #[cfg(windows)]
    media::set_playback(_app, true, !playback.continuous.snapshot().ended);
    Ok(())
}

pub(crate) fn stop_playback(
    _app: &tauri::AppHandle,
    playback_id: u64,
    state: &PlaybackState,
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
    media::set_playback(_app, false, false);
    Ok(true)
}

pub(crate) fn seek_to(position_ms: u64, state: &PlaybackState) -> Result<(), String> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let playback = active
        .as_mut()
        .ok_or_else(|| "No audio is loaded".to_owned())?;
    let snapshot = playback.continuous.snapshot();
    let position = Duration::from_millis(if snapshot.duration.is_zero() {
        position_ms
    } else {
        position_ms.min(duration_ms(snapshot.duration))
    });
    playback
        .player
        .try_seek(position)
        .map_err(|error| format!("Could not seek in audio: {error}"))?;

    playback.spectrum.reset();
    Ok(())
}

#[tauri::command]
pub fn playback_spectrum(
    playback_id: u64,
    state: State<'_, PlaybackState>,
) -> Result<[f32; BAND_COUNT], String> {
    state.spectrum(playback_id)
}

impl PlaybackState {
    fn spectrum(&self, playback_id: u64) -> Result<[f32; BAND_COUNT], String> {
        let capture = {
            let active = self
                .active
                .lock()
                .map_err(|_| "Playback state is unavailable")?;
            let Some(playback) = active.as_ref() else {
                return Ok([0.0; BAND_COUNT]);
            };
            let snapshot = playback.continuous.snapshot();
            if snapshot.track.playback_id != playback_id
                || snapshot.ended
                || playback.player.is_paused()
            {
                return Ok([0.0; BAND_COUNT]);
            }
            playback.spectrum.clone()
        };
        Ok(capture.bands())
    }
}

pub(crate) fn playback_status(state: &PlaybackState) -> Result<PlaybackStatus, String> {
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
    let duration = source.total_duration().unwrap_or_default();
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
        app.state::<crate::playback_statistics::StatisticsRecorder>()
            .0
            .clone(),
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
            media::set_track(
                &app,
                &app.state::<Database>(),
                track.track_id,
                track.title.as_deref().unwrap_or(""),
                track.artist.as_deref().unwrap_or(""),
            );
        }
    });
    let (player, spectrum) = connect_source(output.mixer(), source, *volume as f32 / 100.0);
    *active = Some(ActivePlayback {
        player,
        spectrum,
        continuous,
        channels,
        sample_rate,
    });
    Ok(())
}

fn connect_source(
    mixer: &rodio::mixer::Mixer,
    source: ContinuousSource,
    volume: f32,
) -> (Player, Arc<SpectrumCapture>) {
    let (player, queue) = Player::new();
    player.set_volume(volume);
    // The mixer must see the real channel count/rate, not an initially empty Player.
    player.append(source);
    // Tap the Player output so pause and volume are reflected in the captured PCM.
    let (source, spectrum) = SpectrumSource::new(queue);
    mixer.add(source);
    (player, spectrum)
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
mod tests;
