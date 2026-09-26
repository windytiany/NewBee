use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

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
    track_count: i64,
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

    pub fn list_albums(&self, album_artist: Option<String>) -> Result<Vec<AlbumSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT album, COUNT(*)
                 FROM tracks
                 WHERE album_artist IS ?1
                 GROUP BY album
                 ORDER BY album IS NULL, album COLLATE NOCASE, album",
            )
            .map_err(|error| format!("Failed to prepare album query: {error}"))?;
        let rows = statement
            .query_map(params![album_artist], |row| {
                Ok(AlbumSummary {
                    album: row.get(0)?,
                    track_count: row.get(1)?,
                })
            })
            .map_err(|error| format!("Failed to list albums: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read albums: {error}"))
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

    pub fn list_playlists(&self) -> Result<Vec<PlaylistSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT p.id, p.name, COUNT(pi.id)
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
                })
            })
            .map_err(|error| format!("Failed to list playlists: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read playlists: {error}"))
    }

    pub fn list_playlist_tracks(&self, playlist_id: i64) -> Result<Vec<TrackSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT t.id, t.title, t.artist, t.album, t.duration_ms
                 FROM playlist_items pi
                 JOIN tracks t ON t.id = pi.track_id
                 WHERE pi.playlist_id = ?1
                 ORDER BY pi.position, pi.id",
            )
            .map_err(|error| format!("Failed to prepare playlist track query: {error}"))?;
        let rows = statement
            .query_map([playlist_id], |row| {
                Ok(TrackSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    duration_ms: row.get(4)?,
                })
            })
            .map_err(|error| format!("Failed to list playlist tracks: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read playlist tracks: {error}"))
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

#[tauri::command]
pub fn list_album_artists(
    state: tauri::State<'_, Database>,
) -> Result<Vec<AlbumArtistSummary>, String> {
    state.list_album_artists()
}

#[tauri::command]
pub fn list_albums(
    album_artist: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Vec<AlbumSummary>, String> {
    state.list_albums(album_artist)
}

#[tauri::command]
pub fn list_album_tracks(
    album_artist: Option<String>,
    album: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Vec<TrackSummary>, String> {
    state.list_album_tracks(album_artist, album)
}

#[tauri::command]
pub fn list_playlists(state: tauri::State<'_, Database>) -> Result<Vec<PlaylistSummary>, String> {
    state.list_playlists()
}

#[tauri::command]
pub fn list_playlist_tracks(
    playlist_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Vec<TrackSummary>, String> {
    state.list_playlist_tracks(playlist_id)
}

#[tauri::command]
pub fn get_track(
    track_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Option<TrackDetails>, String> {
    state.get_track(track_id)
}

#[tauri::command]
pub fn get_track_artwork(
    track_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Option<TrackArtwork>, String> {
    state.get_track_artwork(track_id)
}
