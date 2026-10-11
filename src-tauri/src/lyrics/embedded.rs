use super::{model::TrackLyrics, parsing::parse};
use crate::database::blocking;

#[tauri::command(rename_all = "camelCase")]
pub async fn get_track_lyrics<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<TrackLyrics, String> {
    blocking(app, move |database| {
        let snapshot = database.get_lyrics(track_id)?;
        Ok(if snapshot.no_lyrics {
            TrackLyrics::Instrumental
        } else {
            snapshot
                .text
                .as_deref()
                .map(parse)
                .unwrap_or(TrackLyrics::None)
        })
    })
    .await
}
