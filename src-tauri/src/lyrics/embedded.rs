use super::{model::TrackLyrics, parsing::parse};
use crate::database::blocking;

#[tauri::command]
pub(crate) async fn get_file_lyrics(path: String) -> Result<TrackLyrics, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let track = crate::metadata::files::read_track(std::path::Path::new(&path))?
            .ok_or_else(|| "不支持的音频文件".to_owned())?;
        Ok(track
            .lyrics
            .as_deref()
            .map(parse)
            .unwrap_or(TrackLyrics::None))
    })
    .await
    .map_err(|error| error.to_string())?
}

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
