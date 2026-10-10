use super::{session::SessionAudio, NowPlayingTrack, PlaybackState, PlaybackStatus};
use crate::database::Database;
use std::collections::HashSet;
use tauri::{AppHandle, Manager};

pub struct DesktopAudio(pub AppHandle);

impl SessionAudio for DesktopAudio {
    fn start(&mut self, track_id: i64, row_key: &str) -> Result<NowPlayingTrack, String> {
        super::play_track(
            &self.0,
            track_id,
            Some(row_key.into()),
            &self.0.state::<Database>(),
            &self.0.state::<PlaybackState>(),
        )
    }

    fn status(&self) -> Result<PlaybackStatus, String> {
        super::playback_status(&self.0.state::<PlaybackState>())
    }

    fn prepare(
        &mut self,
        playback_id: u64,
        revision: u64,
        track: Option<&super::queue::QueueTrack>,
    ) -> Result<bool, String> {
        super::prepare_next_track(
            playback_id,
            revision,
            track.map(|track| track.track_id),
            track.map(|track| track.row_key.clone()),
            &self.0.state::<Database>(),
            &self.0.state::<PlaybackState>(),
        )
    }

    fn stop(&mut self, playback_id: u64) -> Result<bool, String> {
        super::stop_playback(&self.0, playback_id, &self.0.state::<PlaybackState>())
    }

    fn pause(&mut self) -> Result<(), String> {
        super::pause(&self.0, &self.0.state::<PlaybackState>())
    }

    fn resume(&mut self) -> Result<(), String> {
        super::resume(&self.0, &self.0.state::<PlaybackState>())
    }

    fn seek(&mut self, position_ms: u64) -> Result<(), String> {
        super::seek_to(position_ms, &self.0.state::<PlaybackState>())
    }

    fn set_volume(&mut self, volume: u8) -> Result<(), String> {
        super::set_volume(volume, &self.0.state::<PlaybackState>())
    }

    fn skipped(&self) -> HashSet<i64> {
        self.0
            .state::<Database>()
            .skipped_tracks()
            .read()
            .unwrap()
            .clone()
    }
}
