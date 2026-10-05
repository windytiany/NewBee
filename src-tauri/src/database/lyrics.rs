use super::Database;
use crate::metadata::model::validate_track_ids;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;

pub(crate) struct LyricsSnapshot {
    pub(crate) text: Option<String>,
    pub(crate) no_lyrics: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyricsDownloadTarget {
    id: i64,
    title: Option<String>,
    artist: Option<String>,
    has_lyrics: bool,
    no_lyrics: bool,
}

impl Database {
    pub(crate) fn get_lyrics(&self, track_id: i64) -> Result<LyricsSnapshot, String> {
        self.connection()?
            .query_row(
                "SELECT l.text, COALESCE(l.no_lyrics, 0)
                 FROM tracks t LEFT JOIN track_lyrics l ON l.track_id = t.id WHERE t.id = ?1",
                [track_id],
                |row| {
                    Ok(LyricsSnapshot {
                        text: row.get(0)?,
                        no_lyrics: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("读取歌词失败：{error}"))?
            .ok_or_else(|| format!("曲目 {track_id} 已不在曲库中"))
    }

    pub(crate) fn lyrics_download_targets(
        &self,
        track_ids: &[i64],
    ) -> Result<Vec<LyricsDownloadTarget>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT t.id, t.title, t.artist, l.text IS NOT NULL, COALESCE(l.no_lyrics, 0)
             FROM tracks t LEFT JOIN track_lyrics l ON l.track_id = t.id WHERE t.id = ?1",
            )
            .map_err(|error| error.to_string())?;
        track_ids
            .iter()
            .map(|id| {
                statement
                    .query_row([id], |row| {
                        Ok(LyricsDownloadTarget {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            artist: row.get(2)?,
                            has_lyrics: row.get(3)?,
                            no_lyrics: row.get(4)?,
                        })
                    })
                    .map_err(|error| format!("读取曲目 {id} 歌词状态失败：{error}"))
            })
            .collect()
    }
}

#[tauri::command]
pub(crate) fn get_lyrics_download_targets(
    track_ids: Vec<i64>,
    state: State<'_, Database>,
) -> Result<Vec<LyricsDownloadTarget>, String> {
    let track_ids = validate_track_ids(&track_ids)?;
    state.lyrics_download_targets(&track_ids)
}
