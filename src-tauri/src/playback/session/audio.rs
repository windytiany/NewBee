use super::SessionAudio;
use crate::database::Database;
use crate::playback::{self, NowPlayingTrack, PlaybackState, PlaybackStatus};
use std::collections::HashSet;
use tauri::{AppHandle, Manager};

pub struct DesktopAudio(pub AppHandle);

impl SessionAudio for DesktopAudio {
    fn register(
        &mut self,
        tracks: &mut Vec<playback::queue::QueueTrack>,
    ) -> Result<Vec<String>, String> {
        let guard = self
            .0
            .state::<crate::locking::write::WriteState>()
            .acquire()?;
        let registration = super::identity::register(&self.0.state::<Database>(), tracks)?;
        drop(guard);
        crate::tracks::scheduling::schedule(&self.0, registration.pending);
        Ok(registration.failures)
    }
    fn start(&mut self, track: &playback::queue::QueueTrack) -> Result<NowPlayingTrack, String> {
        if let Some(id) = track.track_id {
            self.0
                .state::<crate::tracks::scheduling::SchedulingState>()
                .prioritize(id);
        }
        playback::play_target(
            &self.0,
            track,
            &self.0.state::<Database>(),
            &self.0.state::<PlaybackState>(),
        )
    }

    fn metadata(&self, ids: &[i64]) -> Result<Vec<super::MetadataUpdate>, String> {
        super::metadata::read(&self.0.state::<Database>(), ids)
    }
    fn paths(&self, track_ids: &[i64]) -> Result<Vec<String>, String> {
        track_ids
            .iter()
            .map(|id| {
                self.0
                    .state::<Database>()
                    .get_track_for_playback(*id)?
                    .map(|track| track.path)
                    .ok_or_else(|| format!("Track {id} not found"))
            })
            .collect()
    }

    fn status(&self) -> Result<PlaybackStatus, String> {
        playback::playback_status(&self.0.state::<PlaybackState>())
    }

    fn prepare(
        &mut self,
        playback_id: u64,
        revision: u64,
        track: Option<&playback::queue::QueueTrack>,
    ) -> Result<bool, String> {
        playback::prepare_next_track(
            playback_id,
            revision,
            track,
            &self.0.state::<Database>(),
            &self.0.state::<PlaybackState>(),
        )
    }

    fn stop(&mut self, playback_id: u64) -> Result<bool, String> {
        playback::stop_playback(&self.0, playback_id, &self.0.state::<PlaybackState>())
    }
    fn pause(&mut self) -> Result<(), String> {
        playback::pause(&self.0, &self.0.state::<PlaybackState>())
    }
    fn resume(&mut self) -> Result<(), String> {
        playback::resume(&self.0, &self.0.state::<PlaybackState>())
    }
    fn seek(&mut self, position_ms: u64) -> Result<(), String> {
        playback::seek_to(position_ms, &self.0.state::<PlaybackState>())
    }
    fn set_volume(&mut self, volume: u8) -> Result<(), String> {
        playback::set_volume(volume, &self.0.state::<PlaybackState>())
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
