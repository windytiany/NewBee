use crate::settings::{AlbumSortBy, AlbumSortOrder};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

pub(crate) mod commands;
mod path_migration;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    title TEXT,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    release_date TEXT,
    disc_number INTEGER,
    track_number INTEGER,
    duration_ms INTEGER,
    codec TEXT,
    sample_rate_hz INTEGER,
    bitrate_kbps INTEGER,
    channels INTEGER
);

CREATE TABLE IF NOT EXISTS track_artwork (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    image BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS music_library_directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_album_artist_album
    ON tracks(album_artist, album);
CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_position
    ON playlist_items(playlist_id, position, id);
CREATE INDEX IF NOT EXISTS idx_playlist_items_track
    ON playlist_items(track_id);
";

pub struct Database {
    connection: Mutex<Connection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumArtistSummary {
    album_artist: Option<String>,
    album_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    album: Option<String>,
    year: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    id: i64,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    id: i64,
    name: String,
    track_count: i64,
    cover_track_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistTrackSummary {
    playlist_item_id: i64,
    track_id: i64,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<i64>,
}

pub(crate) struct TrackPlaybackInfo {
    pub(crate) path: String,
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDetails {
    id: i64,
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    release_date: Option<String>,
    disc_number: Option<i64>,
    track_number: Option<i64>,
    duration_ms: Option<i64>,
    codec: Option<String>,
    sample_rate_hz: Option<i64>,
    bitrate_kbps: Option<i64>,
    channels: Option<i64>,
}

impl TrackDetails {
    pub(crate) fn path(&self) -> &str {
        &self.path
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibraryDirectory {
    pub(crate) id: i64,
    pub(crate) path: String,
    display_path: String,
}

pub struct ScannedTrack {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub release_date: Option<String>,
    pub disc_number: Option<i64>,
    pub track_number: Option<i64>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub sample_rate_hz: Option<i64>,
    pub bitrate_kbps: Option<i64>,
    pub channels: Option<i64>,
    pub artwork: Option<EmbeddedArtwork>,
}

pub struct EmbeddedArtwork {
    pub mime_type: String,
    pub image: Vec<u8>,
}

pub enum TrackWriteOutcome {
    Added,
    Updated,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TrackArtwork {
    Available { mime_type: String, data: Vec<u8> },
    NoArtwork,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        connection.execute_batch(SCHEMA)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Database connection is unavailable".to_owned())
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

    pub fn upsert_scanned_track(&self, track: &ScannedTrack) -> Result<TrackWriteOutcome, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start track update: {error}"))?;
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
                    bitrate_kbps, channels
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
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
                    channels = excluded.channels",
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
                ],
            )
            .map_err(|error| format!("Failed to write track metadata: {error}"))?;

        let track_id = existing_id.unwrap_or_else(|| transaction.last_insert_rowid());
        if let Some(artwork) = track.artwork.as_ref() {
            transaction
                .execute(
                    "INSERT INTO track_artwork (track_id, mime_type, image)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(track_id) DO UPDATE SET
                        mime_type = excluded.mime_type,
                        image = excluded.image",
                    params![track_id, &artwork.mime_type, &artwork.image],
                )
                .map_err(|error| format!("Failed to write track artwork: {error}"))?;
        } else {
            transaction
                .execute("DELETE FROM track_artwork WHERE track_id = ?1", [track_id])
                .map_err(|error| format!("Failed to remove missing track artwork: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("Failed to finish track update: {error}"))?;
        Ok(if existing_id.is_some() {
            TrackWriteOutcome::Updated
        } else {
            TrackWriteOutcome::Added
        })
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
                "SELECT ta.mime_type, ta.image
                 FROM tracks t
                 INNER JOIN track_artwork ta ON ta.track_id = t.id
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
                "SELECT id, title, artist, album, duration_ms
                 FROM tracks
                 WHERE album_artist IS ?1 AND album IS ?2
                 ORDER BY disc_number IS NULL, disc_number,
                          track_number IS NULL, track_number, id",
            )
            .map_err(|error| format!("Failed to prepare album track query: {error}"))?;
        let rows = statement
            .query_map(params![album_artist, album], |row| {
                Ok(TrackSummary {
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

    pub fn create_playlist(&self, name: &str) -> Result<i64, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Playlist name cannot be empty".to_owned());
        }

        let connection = self.connection()?;
        connection
            .execute("INSERT INTO playlists (name) VALUES (?1)", [name])
            .map_err(|error| format!("Failed to create playlist: {error}"))?;
        Ok(connection.last_insert_rowid())
    }

    pub fn rename_playlist(&self, playlist_id: i64, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Playlist name cannot be empty".to_owned());
        }

        let connection = self.connection()?;
        let affected_rows = connection
            .execute(
                "UPDATE playlists SET name = ?1 WHERE id = ?2",
                params![name, playlist_id],
            )
            .map_err(|error| format!("Failed to rename playlist {playlist_id}: {error}"))?;
        if affected_rows == 0 {
            return Err(format!("Playlist {playlist_id} was not found"));
        }
        Ok(())
    }

    pub fn delete_playlist(&self, playlist_id: i64) -> Result<(), String> {
        let connection = self.connection()?;
        let affected_rows = connection
            .execute("DELETE FROM playlists WHERE id = ?1", [playlist_id])
            .map_err(|error| format!("Failed to delete playlist {playlist_id}: {error}"))?;
        if affected_rows == 0 {
            return Err(format!("Playlist {playlist_id} was not found"));
        }
        Ok(())
    }

    pub fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start playlist update: {error}"))?;
        let playlist = transaction
            .query_row(
                "SELECT id FROM playlists WHERE id = ?1",
                [playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to verify playlist {playlist_id}: {error}"))?;
        if playlist.is_none() {
            return Err(format!("Playlist {playlist_id} was not found"));
        }

        let track = transaction
            .query_row("SELECT id FROM tracks WHERE id = ?1", [track_id], |row| {
                row.get::<_, i64>(0)
            })
            .optional()
            .map_err(|error| format!("Failed to verify track {track_id}: {error}"))?;
        if track.is_none() {
            return Err(format!("Track {track_id} was not found"));
        }

        let position = transaction
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1
                 FROM playlist_items
                 WHERE playlist_id = ?1",
                [playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Failed to find playlist {playlist_id} end: {error}"))?;
        transaction
            .execute(
                "INSERT INTO playlist_items (playlist_id, track_id, position)
                 VALUES (?1, ?2, ?3)",
                params![playlist_id, track_id, position],
            )
            .map_err(|error| {
                format!("Failed to add track {track_id} to playlist {playlist_id}: {error}")
            })?;
        transaction
            .commit()
            .map_err(|error| format!("Failed to finish playlist update: {error}"))?;
        Ok(())
    }

    pub fn list_playlists(&self) -> Result<Vec<PlaylistSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT p.id, p.name, COUNT(pi.id),
                        (SELECT cover_item.track_id
                         FROM playlist_items cover_item
                         WHERE cover_item.playlist_id = p.id
                         ORDER BY cover_item.position ASC, cover_item.id ASC
                         LIMIT 1)
                 FROM playlists p
                 LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
                 GROUP BY p.id, p.name
                 ORDER BY p.name COLLATE NOCASE, p.id",
            )
            .map_err(|error| format!("Failed to prepare playlist query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(PlaylistSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    track_count: row.get(2)?,
                    cover_track_id: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to list playlists: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read playlists: {error}"))
    }

    pub fn remove_playlist_items(
        &self,
        playlist_id: i64,
        playlist_item_ids: Vec<i64>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start playlist update: {error}"))?;
        let playlist = transaction
            .query_row(
                "SELECT id FROM playlists WHERE id = ?1",
                [playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to verify playlist {playlist_id}: {error}"))?;
        if playlist.is_none() {
            return Err(format!("Playlist {playlist_id} was not found"));
        }

        if playlist_item_ids.is_empty() {
            transaction
                .commit()
                .map_err(|error| format!("Failed to finish playlist update: {error}"))?;
            return Ok(());
        }

        let mut unique_ids = HashSet::with_capacity(playlist_item_ids.len());
        for item_id in &playlist_item_ids {
            if !unique_ids.insert(*item_id) {
                return Err(format!("Playlist item ID {item_id} appears more than once"));
            }
        }

        for item_id in &playlist_item_ids {
            let item = transaction
                .query_row(
                    "SELECT id FROM playlist_items WHERE id = ?1 AND playlist_id = ?2",
                    params![item_id, playlist_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| format!("Failed to verify playlist item {item_id}: {error}"))?;
            if item.is_none() {
                return Err(format!(
                    "Playlist item {item_id} was not found in playlist {playlist_id}"
                ));
            }
        }

        for item_id in playlist_item_ids {
            let removed = transaction
                .execute(
                    "DELETE FROM playlist_items WHERE id = ?1 AND playlist_id = ?2",
                    params![item_id, playlist_id],
                )
                .map_err(|error| {
                    format!(
                        "Failed to remove playlist item {item_id} from playlist {playlist_id}: {error}"
                    )
                })?;
            if removed != 1 {
                return Err(format!(
                    "Playlist item {item_id} changed while removing it from playlist {playlist_id}"
                ));
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("Failed to finish playlist update: {error}"))?;
        Ok(())
    }

    pub fn reorder_playlist_items(
        &self,
        playlist_id: i64,
        ordered_playlist_item_ids: Vec<i64>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Failed to start playlist update: {error}"))?;
        let playlist = transaction
            .query_row(
                "SELECT id FROM playlists WHERE id = ?1",
                [playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to verify playlist {playlist_id}: {error}"))?;
        if playlist.is_none() {
            return Err(format!("Playlist {playlist_id} was not found"));
        }

        let current_item_ids = {
            let mut statement = transaction
                .prepare("SELECT id FROM playlist_items WHERE playlist_id = ?1 ORDER BY id")
                .map_err(|error| {
                    format!("Failed to prepare playlist {playlist_id} item query: {error}")
                })?;
            let rows = statement
                .query_map([playlist_id], |row| row.get::<_, i64>(0))
                .map_err(|error| {
                    format!("Failed to read playlist {playlist_id} item IDs: {error}")
                })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| {
                    format!("Failed to read playlist {playlist_id} item IDs: {error}")
                })?
        };
        let current_ids = current_item_ids.into_iter().collect::<HashSet<_>>();
        let ordered_ids = ordered_playlist_item_ids
            .iter()
            .copied()
            .collect::<HashSet<_>>();
        if ordered_ids.len() != ordered_playlist_item_ids.len() {
            return Err("Playlist item IDs must not contain duplicates".to_owned());
        }
        if ordered_ids != current_ids {
            return Err(format!(
                "Ordered playlist item IDs must exactly match playlist {playlist_id}"
            ));
        }

        for (position, item_id) in ordered_playlist_item_ids.into_iter().enumerate() {
            let position = i64::try_from(position)
                .map_err(|_| format!("Playlist {playlist_id} has too many items to reorder"))?;
            let updated = transaction
                .execute(
                    "UPDATE playlist_items SET position = ?1 WHERE playlist_id = ?2 AND id = ?3",
                    params![position, playlist_id, item_id],
                )
                .map_err(|error| {
                    format!(
                        "Failed to reorder playlist item {item_id} in playlist {playlist_id}: {error}"
                    )
                })?;
            if updated != 1 {
                return Err(format!(
                    "Playlist item {item_id} changed while reordering playlist {playlist_id}"
                ));
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("Failed to finish playlist update: {error}"))?;
        Ok(())
    }

    pub fn list_playlist_tracks(
        &self,
        playlist_id: i64,
    ) -> Result<Vec<PlaylistTrackSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT pi.id, t.id, t.title, t.artist, t.album, t.duration_ms
                 FROM playlist_items pi
                 JOIN tracks t ON t.id = pi.track_id
                 WHERE pi.playlist_id = ?1
                 ORDER BY pi.position, pi.id",
            )
            .map_err(|error| format!("Failed to prepare playlist track query: {error}"))?;
        let rows = statement
            .query_map([playlist_id], |row| {
                Ok(PlaylistTrackSummary {
                    playlist_item_id: row.get(0)?,
                    track_id: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    album: row.get(4)?,
                    duration_ms: row.get(5)?,
                })
            })
            .map_err(|error| format!("Failed to list playlist tracks: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read playlist tracks: {error}"))
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
                        bitrate_kbps, channels
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
                "SELECT ta.mime_type, ta.image
                 FROM tracks t
                 LEFT JOIN track_artwork ta ON ta.track_id = t.id
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

#[cfg(test)]
mod tests {
    use super::{AlbumSortBy, AlbumSortOrder, Database, TrackArtwork};
    use rusqlite::params;

    #[test]
    fn album_date_sorting_uses_full_dates_but_exposes_only_the_year() {
        let database = Database::open(":memory:").unwrap();
        for (id, album, release_date) in [
            (1, "STUDY WITH MIKU part1", Some("2023-08-09")),
            (2, "STUDY WITH MIKU part2", Some("2023-08-25")),
            (3, "STUDY WITH MIKU part6", Some("2026-01-01")),
            (4, "Later month", Some("2023-12-01")),
            (5, "Year only", Some("2023")),
            (6, "Month only", Some("2023-08")),
            (7, "No date", None),
            (8, "Invalid date", Some("unknown")),
            (9, "STUDY WITH MIKU part2", Some("2023-09-01")),
        ] {
            insert_track(&database, id, Some("Artist"), Some(album), 1, None);
            database
                .connection()
                .unwrap()
                .execute(
                    "UPDATE tracks SET release_date = ?1 WHERE id = ?2",
                    params![release_date, id],
                )
                .unwrap();
        }
        for (sort_order, expected) in [
            (
                AlbumSortOrder::Ascending,
                vec![
                    "Year only",
                    "Month only",
                    "STUDY WITH MIKU part1",
                    "STUDY WITH MIKU part2",
                    "Later month",
                    "STUDY WITH MIKU part6",
                    "Invalid date",
                    "No date",
                ],
            ),
            (
                AlbumSortOrder::Descending,
                vec![
                    "STUDY WITH MIKU part6",
                    "Later month",
                    "STUDY WITH MIKU part2",
                    "STUDY WITH MIKU part1",
                    "Month only",
                    "Year only",
                    "Invalid date",
                    "No date",
                ],
            ),
        ] {
            let albums = database
                .list_albums(Some("Artist".to_owned()), AlbumSortBy::Year, sort_order)
                .unwrap();
            assert_eq!(
                albums
                    .iter()
                    .map(|album| album.album.as_deref().unwrap())
                    .collect::<Vec<_>>(),
                expected,
                "{sort_order:?}",
            );
            for album in &albums {
                let expected_year = match album.album.as_deref().unwrap() {
                    "STUDY WITH MIKU part6" => Some(2026),
                    "No date" | "Invalid date" => None,
                    _ => Some(2023),
                };
                assert_eq!(album.year, expected_year);
                assert!(serde_json::to_value(album)
                    .unwrap()
                    .get("releaseDate")
                    .is_none());
            }
        }
    }

    #[test]
    fn album_sorting_supports_names_years_and_both_directions() {
        let database = Database::open(":memory:").unwrap();
        for (id, album, release_date) in [
            (1, Some("Zulu"), Some("1990-01-01")),
            (2, Some("alpha"), Some("2024")),
            (3, Some("Bravo"), Some("2024-06-01")),
            (4, Some("No year"), None),
            (5, Some("Invalid year"), Some("unknown")),
            (6, None, Some("2010")),
            (7, Some("Zulu"), Some("2000")),
        ] {
            insert_track(&database, id, Some("Artist"), album, 1, None);
            database
                .connection()
                .unwrap()
                .execute(
                    "UPDATE tracks SET release_date = ?1 WHERE id = ?2",
                    params![release_date, id],
                )
                .unwrap();
        }
        insert_track(
            &database,
            8,
            Some("Other artist"),
            Some("Excluded"),
            1,
            None,
        );
        for (sort_by, sort_order, expected) in [
            (
                AlbumSortBy::Name,
                AlbumSortOrder::Ascending,
                vec![
                    Some("alpha"),
                    Some("Bravo"),
                    Some("Invalid year"),
                    Some("No year"),
                    Some("Zulu"),
                    None,
                ],
            ),
            (
                AlbumSortBy::Name,
                AlbumSortOrder::Descending,
                vec![
                    Some("Zulu"),
                    Some("No year"),
                    Some("Invalid year"),
                    Some("Bravo"),
                    Some("alpha"),
                    None,
                ],
            ),
            (
                AlbumSortBy::Year,
                AlbumSortOrder::Ascending,
                vec![
                    Some("Zulu"),
                    None,
                    Some("alpha"),
                    Some("Bravo"),
                    Some("Invalid year"),
                    Some("No year"),
                ],
            ),
            (
                AlbumSortBy::Year,
                AlbumSortOrder::Descending,
                vec![
                    Some("Bravo"),
                    Some("alpha"),
                    None,
                    Some("Zulu"),
                    Some("Invalid year"),
                    Some("No year"),
                ],
            ),
        ] {
            let albums = database
                .list_albums(Some("Artist".to_owned()), sort_by, sort_order)
                .unwrap();
            assert_eq!(
                albums
                    .iter()
                    .map(|album| album.album.as_deref())
                    .collect::<Vec<_>>(),
                expected,
                "{sort_by:?} {sort_order:?}",
            );
            assert_eq!(
                albums
                    .iter()
                    .find(|album| album.album.as_deref() == Some("Zulu"))
                    .unwrap()
                    .year,
                Some(1990)
            );
        }
        let unknown_artist = database
            .list_albums(None, AlbumSortBy::Year, AlbumSortOrder::Descending)
            .unwrap();
        assert!(unknown_artist.is_empty());
    }

    fn insert_track(
        database: &Database,
        id: i64,
        album_artist: Option<&str>,
        album: Option<&str>,
        track_number: i64,
        artwork: Option<&[u8]>,
    ) {
        let connection = database.connection().unwrap();
        connection
            .execute(
                "INSERT INTO tracks (id, path, album, album_artist, track_number)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    id,
                    format!("track-{id}.mp3"),
                    album,
                    album_artist,
                    track_number
                ],
            )
            .unwrap();

        if let Some(image) = artwork {
            connection
                .execute(
                    "INSERT INTO track_artwork (track_id, mime_type, image)
                     VALUES (?1, 'image/png', ?2)",
                    params![id, image],
                )
                .unwrap();
        }
    }

    #[test]
    fn renaming_playlist_trims_name_and_preserves_items_and_allows_duplicates() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Favorites").unwrap();
        let duplicate_name_id = database.create_playlist("Renamed").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
        database.add_track_to_playlist(playlist_id, 2).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        let original_items = database.list_playlist_tracks(playlist_id).unwrap();

        database
            .rename_playlist(playlist_id, "  Renamed  ")
            .unwrap();

        let playlists = database.list_playlists().unwrap();
        assert_eq!(
            playlists
                .iter()
                .filter(|playlist| playlist.name == "Renamed")
                .count(),
            2
        );
        let renamed_playlist = playlists
            .iter()
            .find(|playlist| playlist.id == playlist_id)
            .unwrap();
        assert_eq!(renamed_playlist.name, "Renamed");
        assert_eq!(renamed_playlist.cover_track_id, Some(2));
        assert_eq!(
            database
                .list_playlist_tracks(playlist_id)
                .unwrap()
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<Vec<_>>(),
            original_items
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            database
                .rename_playlist(duplicate_name_id, "  ")
                .unwrap_err(),
            "Playlist name cannot be empty"
        );
        assert_eq!(
            database.rename_playlist(99, "Missing").unwrap_err(),
            "Playlist 99 was not found"
        );
    }

    #[test]
    fn deleting_playlist_cascades_items_but_preserves_tracks_and_other_playlists() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("To delete").unwrap();
        let other_playlist_id = database.create_playlist("Keep").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database
            .add_track_to_playlist(other_playlist_id, 2)
            .unwrap();
        let other_item_id =
            database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;
        let foreign_keys_enabled: i64 = database
            .connection()
            .unwrap()
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys_enabled, 1);

        database.delete_playlist(playlist_id).unwrap();

        assert_eq!(
            database
                .list_playlists()
                .unwrap()
                .iter()
                .map(|playlist| playlist.id)
                .collect::<Vec<_>>(),
            vec![other_playlist_id]
        );
        assert!(database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .is_empty());
        assert_eq!(
            database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id,
            other_item_id
        );
        assert!(database.get_track(1).unwrap().is_some());
        assert!(database.get_track(2).unwrap().is_some());
        assert_eq!(
            database.delete_playlist(99).unwrap_err(),
            "Playlist 99 was not found"
        );
    }

    #[test]
    fn adding_tracks_appends_to_playlist_and_allows_duplicates() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Favorites").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);

        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database.add_track_to_playlist(playlist_id, 2).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();

        let tracks = database.list_playlist_tracks(playlist_id).unwrap();
        assert_eq!(
            tracks
                .iter()
                .map(|track| track.track_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 1]
        );
        assert_eq!(database.list_playlists().unwrap()[0].track_count, 3);
        assert_eq!(
            database.add_track_to_playlist(playlist_id, 99).unwrap_err(),
            "Track 99 was not found"
        );
        assert_eq!(
            database.add_track_to_playlist(99, 1).unwrap_err(),
            "Playlist 99 was not found"
        );
    }

    #[test]
    fn playlist_cover_uses_first_item_by_position_then_id() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Cover").unwrap();
        let empty_playlist_id = database.create_playlist("Empty").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
        insert_track(&database, 3, Some("Artist"), Some("Album"), 3, None);
        {
            let connection = database.connection().unwrap();
            connection
                .execute(
                    "INSERT INTO playlist_items (id, playlist_id, track_id, position)
                     VALUES (20, ?1, 2, 0), (10, ?1, 1, 0), (30, ?1, 3, 1)",
                    [playlist_id],
                )
                .unwrap();
        }

        let playlists = database.list_playlists().unwrap();
        let playlist = playlists
            .iter()
            .find(|playlist| playlist.id == playlist_id)
            .unwrap();
        let empty_playlist = playlists
            .iter()
            .find(|playlist| playlist.id == empty_playlist_id)
            .unwrap();
        assert_eq!(playlist.track_count, 3);
        assert_eq!(playlist.cover_track_id, Some(1));
        assert_eq!(empty_playlist.cover_track_id, None);

        let item_ids = database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>();
        database
            .remove_playlist_items(playlist_id, vec![item_ids[0]])
            .unwrap();
        let updated_playlist = database
            .list_playlists()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == playlist_id)
            .unwrap();
        assert_eq!(updated_playlist.cover_track_id, Some(2));
    }

    #[test]
    fn remove_playlist_items_validates_all_ids_before_deleting() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Favorites").unwrap();
        let other_playlist_id = database.create_playlist("Other").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database.add_track_to_playlist(playlist_id, 2).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database
            .add_track_to_playlist(other_playlist_id, 2)
            .unwrap();
        let playlist_items = database.list_playlist_tracks(playlist_id).unwrap();
        let other_playlist_item_id =
            database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;
        let original_ids = playlist_items
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>();

        assert!(database
            .remove_playlist_items(playlist_id, vec![original_ids[0], original_ids[0]])
            .is_err());
        assert!(database
            .remove_playlist_items(playlist_id, vec![original_ids[0], other_playlist_item_id])
            .is_err());
        assert_eq!(
            database
                .list_playlist_tracks(playlist_id)
                .unwrap()
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<Vec<_>>(),
            original_ids
        );

        database.remove_playlist_items(playlist_id, vec![]).unwrap();
        database
            .remove_playlist_items(playlist_id, vec![original_ids[0]])
            .unwrap();
        let remaining_items = database.list_playlist_tracks(playlist_id).unwrap();
        assert_eq!(
            remaining_items
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<Vec<_>>(),
            vec![original_ids[1], original_ids[2]]
        );
        assert!(database.get_track(1).unwrap().is_some());
        assert_eq!(
            database.remove_playlist_items(99, vec![]).unwrap_err(),
            "Playlist 99 was not found"
        );
    }

    #[test]
    fn removing_one_duplicate_playlist_item_preserves_its_siblings_and_tracks() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Favorites").unwrap();
        let other_playlist_id = database.create_playlist("Other").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database
            .add_track_to_playlist(other_playlist_id, 1)
            .unwrap();

        let duplicate_ids = database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>();
        let other_item_id =
            database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;
        database
            .remove_playlist_items(playlist_id, vec![duplicate_ids[1]])
            .unwrap();

        let remaining_items = database.list_playlist_tracks(playlist_id).unwrap();
        assert_eq!(remaining_items.len(), 1);
        assert_eq!(remaining_items[0].playlist_item_id, duplicate_ids[0]);
        assert_eq!(remaining_items[0].track_id, 1);
        assert_eq!(
            database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id,
            other_item_id
        );
        assert!(database.get_track(1).unwrap().is_some());
        assert!(database.get_track(2).unwrap().is_some());
    }

    #[test]
    fn reorder_playlist_items_requires_exact_ids_and_rolls_back_failures() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Favorites").unwrap();
        let other_playlist_id = database.create_playlist("Other").unwrap();
        let empty_playlist_id = database.create_playlist("Empty").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database.add_track_to_playlist(playlist_id, 2).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database
            .add_track_to_playlist(other_playlist_id, 2)
            .unwrap();
        let item_ids = database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>();
        let other_item_id =
            database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;

        assert!(database
            .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[0], item_ids[2]])
            .is_err());
        assert!(database
            .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[1], other_item_id])
            .is_err());
        assert!(database
            .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[1]])
            .is_err());
        assert!(database
            .reorder_playlist_items(
                playlist_id,
                vec![item_ids[0], item_ids[1], item_ids[2], 999]
            )
            .is_err());
        assert_eq!(
            database
                .list_playlist_tracks(playlist_id)
                .unwrap()
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<Vec<_>>(),
            item_ids
        );

        let connection = database.connection().unwrap();
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER fail_playlist_reorder
                 BEFORE UPDATE OF position ON playlist_items
                 WHEN NEW.id = {} AND NEW.position = 1
                 BEGIN SELECT RAISE(ABORT, 'test reorder failure'); END;",
                item_ids[1]
            ))
            .unwrap();
        drop(connection);
        assert!(database
            .reorder_playlist_items(playlist_id, vec![item_ids[2], item_ids[1], item_ids[0]])
            .is_err());
        assert_eq!(
            database
                .list_playlist_tracks(playlist_id)
                .unwrap()
                .iter()
                .map(|item| item.playlist_item_id)
                .collect::<Vec<_>>(),
            item_ids
        );
        database
            .connection()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_playlist_reorder")
            .unwrap();

        database
            .reorder_playlist_items(playlist_id, vec![item_ids[2], item_ids[1], item_ids[0]])
            .unwrap();
        database
            .reorder_playlist_items(empty_playlist_id, vec![])
            .unwrap();
        let reordered_ids = database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>();
        assert_eq!(reordered_ids, vec![item_ids[2], item_ids[1], item_ids[0]]);
        let connection = database.connection().unwrap();
        let mut statement = connection
            .prepare("SELECT position FROM playlist_items WHERE playlist_id = ?1 ORDER BY position")
            .unwrap();
        let positions = statement
            .query_map([playlist_id], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(positions, vec![0, 1, 2]);
    }

    #[test]
    fn removing_track_cascades_playlist_items_without_deleting_the_file() {
        let database = Database::open(":memory:").unwrap();
        let playlist_id = database.create_playlist("Favorites").unwrap();
        let path = std::env::temp_dir().join(format!(
            "newbee-delete-track-{}-{}.mp3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"audio remains on disk").unwrap();
        let path_string = path.to_string_lossy().into_owned();
        database
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO tracks (id, path, title) VALUES (1, ?1, 'Track')",
                [&path_string],
            )
            .unwrap();
        database
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO track_artwork (track_id, mime_type, image)
                 VALUES (1, 'image/png', X'0102')",
                [],
            )
            .unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();
        database.add_track_to_playlist(playlist_id, 1).unwrap();

        database.remove_track_from_library(1).unwrap();

        assert!(database.get_track(1).unwrap().is_none());
        assert!(database.get_track_artwork(1).unwrap().is_none());
        assert!(database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .is_empty());
        assert_eq!(database.list_playlists().unwrap()[0].track_count, 0);
        assert_eq!(std::fs::read(&path).unwrap(), b"audio remains on disk");
        std::fs::remove_file(path).unwrap();
        assert_eq!(
            database.remove_track_from_library(1).unwrap_err(),
            "Track 1 was not found"
        );
    }

    #[test]
    fn get_album_artwork_returns_first_available_cover_and_matches_null_metadata() {
        let database = Database::open(":memory:").unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        insert_track(
            &database,
            2,
            Some("Artist"),
            Some("Album"),
            2,
            Some(&[2, 3]),
        );
        insert_track(
            &database,
            3,
            Some("Artist"),
            Some("Album"),
            3,
            Some(&[4, 5]),
        );
        insert_track(&database, 4, None, None, 1, Some(&[6, 7]));

        let artwork = database
            .get_album_artwork(Some("Artist".to_owned()), Some("Album".to_owned()))
            .unwrap();
        assert!(matches!(
            artwork,
            Some(TrackArtwork::Available { mime_type, data })
                if mime_type == "image/png" && data == vec![2, 3]
        ));

        let artwork = database.get_album_artwork(None, None).unwrap();
        assert!(matches!(
            artwork,
            Some(TrackArtwork::Available { data, .. }) if data == vec![6, 7]
        ));

        assert!(database
            .get_album_artwork(Some("Missing".to_owned()), Some("Album".to_owned()))
            .unwrap()
            .is_none());
    }
}
