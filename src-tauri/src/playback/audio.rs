use super::continuous::{ContinuousSource, PreparedTrack};
#[cfg(windows)]
use super::media;
use super::spectrum::{SpectrumCapture, SpectrumSource};
use super::{gain, queue, statistics, ActivePlayback, NowPlayingTrack, PlaybackState};
use crate::database::Database;
use rodio::source::UniformSourceIterator;
use rodio::{ChannelCount, Decoder, DeviceSinkBuilder, Player, SampleRate, Source};
use std::fs::File;
use std::io::{BufReader, ErrorKind};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;

pub(super) const AUDIO_FILE_NOT_FOUND_PREFIX: &str = "AUDIO_FILE_NOT_FOUND:";

pub(super) enum PlaybackError {
    AudioFileNotFound(String),
    Other(String),
}

impl PlaybackError {
    fn into_message(self) -> String {
        match self {
            Self::AudioFileNotFound(message) | Self::Other(message) => message,
        }
    }

    pub(super) fn into_play_command_message(self) -> String {
        match self {
            Self::AudioFileNotFound(message) => {
                format!("{AUDIO_FILE_NOT_FOUND_PREFIX} {message}")
            }
            Self::Other(message) => message,
        }
    }
}

pub(super) fn target_info(
    track: &queue::QueueTrack,
    database: &Database,
) -> Result<crate::tracks::model::TrackPlaybackInfo, String> {
    let id = track.track_id.ok_or("Playback target must be registered")?;
    if track.path.is_some() {
        return Err("Playback target must use its registered ID".into());
    }
    database
        .get_track_for_playback(id)?
        .ok_or_else(|| format!("Track {id} was not found"))
}

pub(crate) fn play_target(
    app: &tauri::AppHandle,
    target: &queue::QueueTrack,
    database: &Database,
    state: &PlaybackState,
) -> Result<NowPlayingTrack, String> {
    let track = target_info(target, database)?;
    let now_playing = NowPlayingTrack {
        track_id: target.track_id,
        path: Some(track.path.clone()),
        playback_id: state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1,
        title: track.title.clone(),
        artist: track.artist.clone(),
        row_key: Some(target.row_key.clone()),
        previous_playback_id: None,
    };
    let prepared = prepare_track(Path::new(&track.path), now_playing.clone(), state)
        .map_err(PlaybackError::into_play_command_message)?;
    start_playback(prepared, state, app).map_err(PlaybackError::into_message)?;
    #[cfg(windows)]
    media::set_track(
        app,
        database,
        target.track_id,
        track.title.as_deref().unwrap_or(""),
        track.artist.as_deref().unwrap_or(""),
    );
    Ok(now_playing)
}

pub(crate) fn prepare_next_track(
    playback_id: u64,
    revision: u64,
    target: Option<&queue::QueueTrack>,
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
    let Some(target) = target else {
        return Ok(true);
    };
    let track = target_info(target, database)?;
    let now_playing = NowPlayingTrack {
        track_id: target.track_id,
        path: Some(track.path.clone()),
        playback_id: state.next_playback_id.fetch_add(1, Ordering::Relaxed) + 1,
        title: track.title,
        artist: track.artist,
        row_key: Some(target.row_key.clone()),
        previous_playback_id: Some(playback_id),
    };
    let next = prepare_track(Path::new(&track.path), now_playing, state)
        .map(|track| normalize_track(track, channels, sample_rate))
        .map_err(PlaybackError::into_play_command_message)?;
    Ok(continuous.prepare(playback_id, revision, next))
}

fn prepare_track(
    path: &Path,
    track: NowPlayingTrack,
    state: &PlaybackState,
) -> Result<PreparedTrack, PlaybackError> {
    let source = open_decoder(path)?;
    let duration = source.total_duration().unwrap_or_default();
    let source = gain::GainSource::new(
        source,
        path,
        state.replay_gain.clone(),
        state.replay_gain_preamp.clone(),
    );
    Ok(PreparedTrack {
        track,
        duration,
        source: Box::new(source),
    })
}

pub(super) fn normalize_track(
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
        app.state::<statistics::StatisticsRecorder>().0.clone(),
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
    let fade = state.playback_fade_in.load(Ordering::Relaxed);
    let volume = *volume as f32 / 100.0;
    let (player, spectrum) =
        connect_source(output.mixer(), source, if fade { 0.0 } else { volume });
    *active = Some(ActivePlayback {
        player: super::transport::Transport::new(player, volume, fade),
        spectrum,
        continuous,
        channels,
        sample_rate,
    });
    Ok(())
}

pub(super) fn connect_source(
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

pub(super) fn open_decoder(path: &Path) -> Result<Decoder<BufReader<File>>, PlaybackError> {
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
