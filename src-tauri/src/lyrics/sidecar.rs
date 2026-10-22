use crate::database::Database;
use crate::lyrics::{model::TrackLyrics, parsing::parse};
use std::path::Path;
use tauri::Manager;

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn get_playback_sidecar_lyrics<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<Option<TrackLyrics>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let track = app
            .state::<Database>()
            .get_track_for_playback(track_id)?
            .ok_or_else(|| "Track not found".to_owned())?;
        Ok(read_sidecar(Path::new(&track.path)))
    })
    .await
    .map_err(|error| format!("Sidecar lyrics task failed: {error}"))?
}

fn read_sidecar(audio: &Path) -> Option<TrackLyrics> {
    let path = audio.with_extension("lrc");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!(
                "event=sidecar_lyrics_read_failed path={} error={error}",
                path.display()
            );
            return None;
        }
    };
    // Metadata-only and malformed LRC tags are not plain lyrics.
    // Reuse embedded parsing for both timed lyrics and untagged plain text.
    match parse(text.trim_start_matches('\u{feff}')) {
        TrackLyrics::Synced { lines } if lines.iter().any(|line| !line.text.trim().is_empty()) => {
            Some(TrackLyrics::Synced { lines })
        }
        TrackLyrics::Plain { text }
            if text.lines().all(|line| !line.trim_start().starts_with('[')) =>
        {
            Some(TrackLyrics::Plain { text })
        }
        _ => {
            if !text.trim().is_empty() {
                log::warn!("event=sidecar_lyrics_parse_failed path={}", path.display());
            }
            None
        }
    }
}

#[tauri::command]
pub(crate) async fn get_file_sidecar_lyrics(path: String) -> Result<Option<TrackLyrics>, String> {
    tauri::async_runtime::spawn_blocking(move || read_sidecar(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())
}
