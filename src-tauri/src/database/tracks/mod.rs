use super::Database;
use crate::artwork::track::TrackArtwork;
use crate::tracks::model::TrackWriteInput;
use crate::tracks::model::{TrackDetails, TrackPlaybackInfo, TrackPresentation};
use rusqlite::{params, OptionalExtension};

pub(crate) mod confirmation;
pub(in crate::database) mod persistence;
mod recovery;
mod registration;

const DETAILS_COLUMNS: &str = "id, path, title, artist, album, album_artist, release_date,
    disc_number, track_number, duration_ms, codec, sample_rate_hz,
    bitrate_kbps, channels, disc_total, track_total";

fn details_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackDetails> {
    Ok(TrackDetails {
        id: row.get(0)?,
        path: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        album_artist: row.get(5)?,
        release_date: row.get(6)?,
        disc_number: row.get(7)?,
        track_number: row.get(8)?,
        duration_ms: row.get(9)?,
        codec: row.get(10)?,
        sample_rate_hz: row.get(11)?,
        bitrate_kbps: row.get(12)?,
        channels: row.get(13)?,
        disc_total: row.get(14)?,
        track_total: row.get(15)?,
    })
}

impl Database {
    pub(crate) fn get_track_for_playback(
        &self,
        track_id: i64,
    ) -> Result<Option<TrackPlaybackInfo>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT path, title, artist FROM tracks WHERE id = ?1",
                [track_id],
                |row| {
                    Ok(TrackPlaybackInfo {
                        path: row.get(0)?,
                        title: row.get(1)?,
                        artist: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Failed to find track {track_id} for playback: {error}"))
    }

    pub fn get_track(&self, track_id: i64) -> Result<Option<TrackDetails>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                &format!("SELECT {DETAILS_COLUMNS} FROM tracks WHERE id = ?1"),
                [track_id],
                details_from_row,
            )
            .optional()
            .map_err(|error| format!("Failed to get track {track_id}: {error}"))
    }

    pub(crate) fn get_track_presentation(
        &self,
        track_id: i64,
    ) -> Result<Option<TrackPresentation>, String> {
        if self.pending_track(track_id)?.is_some() {
            return Ok(None);
        }
        let track = self
            .get_track(track_id)?
            .ok_or_else(|| format!("曲目 {track_id} 已不在数据库中"))?;
        Ok(Some(TrackPresentation {
            title: track
                .title
                .filter(|title| !title.trim().is_empty())
                .or_else(|| {
                    std::path::Path::new(&track.path)
                        .file_stem()
                        .map(|name| name.to_string_lossy().into_owned())
                }),
            album: track.album.filter(|album| !album.trim().is_empty()),
            duration_ms: track.duration_ms,
        }))
    }

    pub(crate) fn get_tracks(&self, track_ids: &[i64]) -> Result<Vec<TrackDetails>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {DETAILS_COLUMNS} FROM tracks WHERE id = ?1"
            ))
            .map_err(|error| error.to_string())?;
        let mut seen = std::collections::HashSet::new();
        let mut tracks = Vec::new();
        for id in track_ids.iter().filter(|id| seen.insert(**id)) {
            if let Some(track) = statement
                .query_row([id], details_from_row)
                .optional()
                .map_err(|error| format!("Failed to get track {id}: {error}"))?
            {
                tracks.push(track);
            }
        }
        Ok(tracks)
    }

    pub fn get_track_artwork(&self, track_id: i64) -> Result<Option<TrackArtwork>, String> {
        let connection = self.connection()?;
        let artwork = connection
            .query_row(
                "SELECT ai.mime_type, ai.image
                 FROM tracks t
                 LEFT JOIN track_artwork ta ON ta.track_id = t.id AND ta.is_display = 1
                 LEFT JOIN artwork_images ai ON ai.id = ta.image_id AND ta.source_error IS NULL
                 WHERE t.id = ?1",
                [track_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<Vec<u8>>>(1)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("Failed to get artwork for track {track_id}: {error}"))?;

        match artwork {
            None => Ok(None),
            Some((Some(mime_type), Some(data))) => {
                Ok(Some(TrackArtwork::Available { mime_type, data }))
            }
            Some((None, None)) => Ok(Some(TrackArtwork::NoArtwork)),
            Some(_) => Err(format!("Artwork record for track {track_id} is invalid")),
        }
    }
}

/// Persist a confirmed snapshot by canonical path without changing library membership.
/// The caller owns the transaction so registration and references can be committed atomically.
pub(crate) fn persist_track(
    transaction: &rusqlite::Transaction<'_>,
    track: &TrackWriteInput,
    artwork_scan: Option<&crate::artwork::track::Scan>,
) -> Result<i64, String> {
    let existing_id = transaction
        .query_row(
            "SELECT id FROM tracks WHERE path = ?1",
            [&track.path],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to check existing track: {error}"))?;

    transaction
        .execute(
            "INSERT INTO tracks (
                    path, title, artist, album, album_artist, release_date,
                    disc_number, track_number, duration_ms, codec, sample_rate_hz,
                    bitrate_kbps, channels, disc_total, track_total
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
                 )
                 ON CONFLICT(path) DO UPDATE SET
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    album_artist = excluded.album_artist,
                    release_date = excluded.release_date,
                    disc_number = excluded.disc_number,
                    track_number = excluded.track_number,
                    duration_ms = excluded.duration_ms,
                    codec = excluded.codec,
                    sample_rate_hz = excluded.sample_rate_hz,
                    bitrate_kbps = excluded.bitrate_kbps,
                    channels = excluded.channels,
                    disc_total = excluded.disc_total,
                    track_total = excluded.track_total,
                    metadata_revision = tracks.metadata_revision + 1",
            params![
                &track.path,
                &track.title,
                &track.artist,
                &track.album,
                &track.album_artist,
                &track.release_date,
                track.disc_number,
                track.track_number,
                track.duration_ms,
                &track.codec,
                track.sample_rate_hz,
                track.bitrate_kbps,
                track.channels,
                track.disc_total,
                track.track_total,
            ],
        )
        .map_err(|error| format!("Failed to write track metadata: {error}"))?;

    let track_id = existing_id.unwrap_or_else(|| transaction.last_insert_rowid());
    if let Some(scan) = artwork_scan {
        super::artwork::synchronization::sync(transaction, track_id, &track.path, scan)?;
        transaction
            .execute(
                "DELETE FROM track_artwork_pending WHERE track_id = ?1",
                [track_id],
            )
            .map_err(|error| error.to_string())?;
    }
    if let Some(editing) = &track.editing {
        let editing = serde_json::to_string(editing)
            .map_err(|error| format!("Failed to serialize editing snapshot: {error}"))?;
        transaction.execute(
                "INSERT INTO track_editing (track_id, snapshot) VALUES (?1, ?2)
                 ON CONFLICT(track_id) DO UPDATE SET snapshot = excluded.snapshot, scan_issue = NULL",
                params![track_id, editing],
            ).map_err(|error| format!("Failed to save editing snapshot: {error}"))?;
    }

    let lyrics = track
        .lyrics
        .as_deref()
        .filter(|text| !text.trim().is_empty());
    transaction.execute(
            "INSERT INTO track_lyrics (track_id, text) VALUES (?1, ?2)
             ON CONFLICT(track_id) DO UPDATE SET
                text = excluded.text,
                no_lyrics = CASE WHEN excluded.text IS NOT NULL THEN 0 ELSE track_lyrics.no_lyrics END",
            params![track_id, lyrics],
        ).map_err(|error| format!("Failed to write track lyrics: {error}"))?;

    Ok(track_id)
}
