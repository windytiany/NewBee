pub(crate) mod qualification;

use crate::database::Database;
use serde::Serialize;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const CHANGED_EVENT: &str = "playback-statistics-changed";
const SAVE_FAILED_EVENT: &str = "playback-statistics-save-failed";

pub(crate) struct StatisticsRecorder(pub mpsc::Sender<i64>);

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackPlayStatistics {
    pub track_id: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub play_count: i64,
}

pub(crate) fn initialize(app: &AppHandle) {
    let (sender, receiver) = mpsc::channel();
    app.manage(StatisticsRecorder(sender));
    let app = app.clone();
    std::thread::spawn(move || {
        while let Ok(track_id) = receiver.recv() {
            match app.state::<Database>().record_track_play(track_id) {
                Ok(true) => {
                    if let Err(error) = app.emit(CHANGED_EVENT, ()) {
                        log::warn!("Could not publish playback statistics: {error}");
                    }
                }
                // Deletion may win the race with an already queued completion.
                Ok(false) => {}
                Err(error) => {
                    log::error!("Could not save playback statistics for track {track_id}: {error}");
                    if let Err(error) = app.emit(SAVE_FAILED_EVENT, ()) {
                        log::warn!("Could not publish playback statistics failure: {error}");
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub(crate) async fn list_playback_statistics(
    app: AppHandle,
) -> Result<Vec<TrackPlayStatistics>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Database>().list_playback_statistics())
        .await
        .map_err(|error| format!("Could not read playback statistics: {error}"))?
}
