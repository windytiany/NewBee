mod audio;
mod continuous;
mod controls;
mod gain;
#[cfg(windows)]
pub(crate) mod media;
mod persistence;
pub(crate) mod queue;
pub(crate) mod session;
pub(crate) mod skip;
mod spectrum;
pub(crate) mod statistics;
mod transport;

pub(crate) use audio::{play_target, prepare_next_track};
pub(crate) use controls::{pause, playback_status, resume, seek_to, set_volume, stop_playback};

use continuous::ContinuousPlayback;
use rodio::{ChannelCount, MixerDeviceSink, SampleRate};
use serde::Serialize;
use spectrum::{SpectrumCapture, BAND_COUNT};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use transport::Transport;

pub struct PlaybackState {
    active: Mutex<Option<ActivePlayback>>,
    output: Mutex<Option<MixerDeviceSink>>,
    volume: Mutex<u8>,
    next_playback_id: AtomicU64,
    playback_fade_in: AtomicBool,
    playback_fade_out: AtomicBool,
    replay_gain: Arc<AtomicBool>,
    replay_gain_preamp: Arc<AtomicU64>,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            output: Mutex::new(None),
            volume: Mutex::new(100),
            next_playback_id: AtomicU64::new(0),
            playback_fade_in: AtomicBool::new(true),
            playback_fade_out: AtomicBool::new(true),
            replay_gain: Arc::new(AtomicBool::new(true)),
            replay_gain_preamp: Arc::new(AtomicU64::new(0.0_f64.to_bits())),
        }
    }
}

impl PlaybackState {
    pub(crate) fn set_playback_fades(&self, fade_in: bool, fade_out: bool) {
        // Serialize disabling with commands so no ramp can start with a stale setting.
        let active = self.active.lock().unwrap();
        self.playback_fade_in.store(fade_in, Ordering::Relaxed);
        self.playback_fade_out.store(fade_out, Ordering::Relaxed);
        if let Some(playback) = active.as_ref() {
            let enabled = if playback.player.is_paused() {
                fade_out
            } else {
                fade_in
            };
            if !enabled {
                playback.player.finish();
            }
        }
    }

    pub(crate) fn set_replay_gain(&self, enabled: bool, preamp_db: f64) {
        self.replay_gain_preamp
            .store(preamp_db.to_bits(), Ordering::Relaxed);
        self.replay_gain.store(enabled, Ordering::Relaxed);
    }
}

struct ActivePlayback {
    player: Transport,
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
    track_id: Option<i64>,
    path: Option<String>,
    playback_id: u64,
    title: Option<String>,
    artist: Option<String>,
    row_key: Option<String>,
    previous_playback_id: Option<u64>,
}

#[tauri::command]
pub fn playback_spectrum(
    playback_id: u64,
    state: State<'_, PlaybackState>,
) -> Result<[f32; BAND_COUNT], String> {
    state.spectrum(playback_id)
}

#[cfg(test)]
use audio::{connect_source, normalize_track, open_decoder, target_info, PlaybackError};
