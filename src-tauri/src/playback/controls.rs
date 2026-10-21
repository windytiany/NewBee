#[cfg(windows)]
use super::media;
use super::spectrum::BAND_COUNT;
use super::{PlaybackState, PlaybackStatus};
use std::time::Duration;

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

impl PlaybackState {
    pub(super) fn spectrum(&self, playback_id: u64) -> Result<[f32; BAND_COUNT], String> {
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

pub(super) fn is_expected_playback_id(
    active_playback_id: Option<u64>,
    expected_playback_id: u64,
) -> bool {
    active_playback_id == Some(expected_playback_id)
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}
