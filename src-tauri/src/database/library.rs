use super::{
    AlbumArtistSummary, AlbumSummary, Database, MusicLibraryDirectory, TrackArtwork, TrackDetails,
    TrackPlaybackInfo, TrackSummary, TrackWriteInput, TrackWriteOutcome,
};
use crate::settings::{AlbumSortBy, AlbumSortOrder};
use rusqlite::{params, OptionalExtension};

impl Database {
    pub(crate) fn track_paths(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT path FROM tracks")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn list_music_library_directories(&self) -> Result<Vec<MusicLibraryDirectory>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT id, path FROM music_library_directories ORDER BY id")
            .map_err(|error| format!("Failed to prepare library directory query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                let id = row.get(0)?;
                let path: String = row.get(1)?;
                Ok(MusicLibraryDirectory {
                    id,
                    display_path: display_directory_path(&path),
                    path,
                })
            })
            .map_err(|error| format!("Failed to list library directories: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read library directories: {error}"))
    }

    pub fn add_music_library_directory(&self, path: &str) -> Result<bool, String> {
        let connection = self.connection()?;
        let inserted = connection
            .execute(
                "INSERT OR IGNORE INTO music_library_directories (path) VALUES (?1)",
                [path],
            )
            .map_err(|error| format!("Failed to save library directory: {error}"))?;
        Ok(inserted > 0)
    }

    pub fn remove_music_library_directory(&self, id: i64) -> Result<(), String> {
        let connection = self.connection()?;
        let removed = connection
            .execute("DELETE FROM music_library_directories WHERE id = ?1", [id])
            .map_err(|error| format!("Failed to remove library directory: {error}"))?;
        if removed == 0 {
            return Err(format!("Library directory {id} was not found"));
        }
        Ok(())
    }

    pub(crate) fn upsert_track(
        &self,
        track: &TrackWriteInput,
        update: super::ArtworkUpdate,
    ) -> Result<TrackWriteOutcome, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let outcome = persist_track(&transaction, track, &update)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(outcome)
    }

    pub fn list_album_artists(&self) -> Result<Vec<AlbumArtistSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT album_artist, COUNT(*)
                 FROM (
                     SELECT album_artist, album
                     FROM tracks
                     GROUP BY album_artist, album
                 )
                 GROUP BY album_artist
                 ORDER BY album_artist IS NOT NULL, album_artist COLLATE NOCASE, album_artist",
            )
            .map_err(|error| format!("Failed to prepare album artist query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(AlbumArtistSummary {
                    album_artist: row.get(0)?,
                    album_count: row.get(1)?,
                })
            })
            .map_err(|error| format!("Failed to list album artists: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read album artists: {error}"))
    }

    pub fn list_albums(
        &self,
        album_artist: Option<String>,
        sort_by: AlbumSortBy,
        sort_order: AlbumSortOrder,
    ) -> Result<Vec<AlbumSummary>, String> {
        let direction = match sort_order {
            AlbumSortOrder::Ascending => "ASC",
            AlbumSortOrder::Descending => "DESC",
        };
        let order_by = match sort_by {
            AlbumSortBy::Name => {
                format!("album IS NULL, album COLLATE NOCASE {direction}, album {direction}")
            }
            AlbumSortBy::Year => {
                format!(
                    "sort_release_date IS NULL, sort_release_date {direction}, album IS NULL, album COLLATE NOCASE, album"
                )
            }
        };
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT album,
                        MIN(
                            CASE
                                WHEN substr(release_date, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
                                THEN CAST(substr(release_date, 1, 4) AS INTEGER)
                            END
                        ) AS year,
                        MIN(
                            CASE
                                WHEN substr(release_date, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
                                THEN release_date
                            END
                        ) AS sort_release_date
                 FROM tracks
                 WHERE album_artist IS ?1
                 GROUP BY album
                 ORDER BY {order_by}",
            ))
            .map_err(|error| format!("Failed to prepare album query: {error}"))?;
        let rows = statement
            .query_map(params![album_artist], |row| {
                Ok(AlbumSummary {
                    album: row.get(0)?,
                    year: row.get(1)?,
                })
            })
            .map_err(|error| format!("Failed to list albums: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read albums: {error}"))
    }

    pub fn get_album_artwork(
        &self,
        album_artist: Option<String>,
        album: Option<String>,
    ) -> Result<Option<TrackArtwork>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT ai.mime_type, ai.image
                 FROM tracks t
                 INNER JOIN track_artwork ta ON ta.track_id = t.id
                 INNER JOIN artwork_images ai ON ai.id = ta.image_id
                 WHERE t.album_artist IS ?1 AND t.album IS ?2
                 ORDER BY t.disc_number IS NULL, t.disc_number,
                          t.track_number IS NULL, t.track_number, t.id
                 LIMIT 1",
                params![album_artist.as_deref(), album.as_deref()],
                |row| {
                    Ok(TrackArtwork::Available {
                        mime_type: row.get(0)?,
                        data: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|error| {
                format!("Failed to get artwork for album {album:?} by {album_artist:?}: {error}")
            })
    }

    pub fn list_album_tracks(
        &self,
        album_artist: Option<String>,
        album: Option<String>,
    ) -> Result<Vec<TrackSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT id, title, artist, album, duration_ms, disc_number, track_number
                 FROM tracks
                 WHERE album_artist IS ?1 AND album IS ?2
                 ORDER BY disc_number IS NULL, disc_number,
                          track_number IS NULL, track_number, id",
            )
            .map_err(|error| format!("Failed to prepare album track query: {error}"))?;
        let rows = statement
            .query_map(params![album_artist, album], |row| {
                Ok(TrackSummary {
                    disc_number: row.get(5)?,
                    track_number: row.get(6)?,
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                })
            })
            .map_err(|error| format!("Failed to list album tracks: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read album tracks: {error}"))
    }
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

    pub fn remove_track_from_library(&self, track_id: i64) -> Result<(), String> {
        let connection = self.connection()?;
        let removed = connection
            .execute("DELETE FROM tracks WHERE id = ?1", [track_id])
            .map_err(|error| format!("Failed to remove track {track_id} from library: {error}"))?;
        if removed == 0 {
            return Err(format!("Track {track_id} was not found"));
        }
        Ok(())
    }

    pub fn get_track(&self, track_id: i64) -> Result<Option<TrackDetails>, String> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT id, path, title, artist, album, album_artist, release_date,
                        disc_number, track_number, duration_ms, codec, sample_rate_hz,
                        bitrate_kbps, channels, disc_total, track_total
                 FROM tracks
                 WHERE id = ?1",
                [track_id],
                |row| {
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
                },
            )
            .optional()
            .map_err(|error| format!("Failed to get track {track_id}: {error}"))
    }

    pub fn get_track_artwork(&self, track_id: i64) -> Result<Option<TrackArtwork>, String> {
        let connection = self.connection()?;
        let artwork = connection
            .query_row(
                "SELECT ai.mime_type, ai.image
                 FROM tracks t
                 LEFT JOIN track_artwork ta ON ta.track_id = t.id
                 LEFT JOIN artwork_images ai ON ai.id = ta.image_id
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

fn display_directory_path(path: &str) -> String {
    #[cfg(windows)]
    {
        const EXTENDED_UNC_PREFIX: &str = r"\\?\UNC\";
        const EXTENDED_PATH_PREFIX: &str = r"\\?\";

        if let Some(unc_path) = path.strip_prefix(EXTENDED_UNC_PREFIX) {
            return format!("\\\\{unc_path}");
        }
        if let Some(drive_path) = path.strip_prefix(EXTENDED_PATH_PREFIX) {
            let bytes = drive_path.as_bytes();
            if bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/')
            {
                return drive_path.to_owned();
            }
        }
    }
    path.to_owned()
}

pub(super) fn persist_track(
    transaction: &rusqlite::Transaction<'_>,
    track: &TrackWriteInput,
    artwork_update: &super::ArtworkUpdate,
) -> Result<TrackWriteOutcome, String> {
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
                    track_total = excluded.track_total",
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
    super::artwork::persist_artwork(
        transaction,
        track_id,
        track.artwork.as_ref(),
        artwork_update,
        &track.path,
    )?;

    if let Some(editing) = &track.editing {
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

    Ok(if existing_id.is_some() {
        TrackWriteOutcome::Updated
    } else {
        TrackWriteOutcome::Added
    })
}
