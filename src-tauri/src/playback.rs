use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

pub struct PlaybackState {
    active: Mutex<Option<ActivePlayback>>,
    volume: Mutex<u8>,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            volume: Mutex::new(100),
        }
    }
}

struct ActivePlayback {
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
    position_ms: u64,
    duration_ms: u64,
}

#[tauri::command]
pub fn play(path: String, state: State<'_, PlaybackState>) -> Result<(), String> {
    let path = PathBuf::from(path);
    let source = open_decoder(&path)?;
    let duration = source
        .total_duration()
        .ok_or_else(|| "Could not determine audio duration".to_owned())?;

    let output = DeviceSinkBuilder::open_default_sink()
        .map_err(|error| format!("Could not open audio output: {error}"))?;
    let volume = state
        .volume
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    let mut active = state
        .active
        .lock()
        .map_err(|_| "Playback state is unavailable".to_owned())?;
    active.take();

    let player = Player::connect_new(output.mixer());
    player.set_volume(*volume as f32 / 100.0);
    player.append(source);
    *active = Some(ActivePlayback {
        player,
        _output: output,
        path,
        duration,
    });

    Ok(())
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

    Ok(PlaybackStatus {
        has_audio: true,
        is_playing: !playback.player.is_paused() && !has_finished,
        position_ms: duration_ms(position),
        duration_ms: duration_ms(playback.duration),
    })
}

fn reload_source_at_position(
    playback: &mut ActivePlayback,
    position: Duration,
) -> Result<(), String> {
    let source = open_decoder(&playback.path)?;
    playback.player.clear();
    playback.player.append(source);
    playback
        .player
        .try_seek(position)
        .map_err(|error| format!("Could not seek in audio: {error}"))?;
    Ok(())
}

fn open_decoder(path: &Path) -> Result<Decoder<BufReader<File>>, String> {
    let file = File::open(path)
        .map_err(|error| format!("Could not open audio file '{}': {error}", path.display()))?;
    Decoder::try_from(file)
        .map_err(|error| format!("Could not decode audio file '{}': {error}", path.display()))
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}
