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

    pub fn list_albums(&self, album_artist: Option<String>) -> Result<Vec<AlbumSummary>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT album,
                        MIN(
                            CASE
                                WHEN substr(release_date, 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
                                THEN CAST(substr(release_date, 1, 4) AS INTEGER)
                            END
                        )
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

#[tauri::command]
pub fn list_music_library_directories(
    state: tauri::State<'_, Database>,
) -> Result<Vec<MusicLibraryDirectory>, String> {
    state.list_music_library_directories()
}

#[tauri::command]
pub fn add_music_library_directory(
    path: String,
    state: tauri::State<'_, Database>,
) -> Result<bool, String> {
    let canonical_path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("Could not open selected directory: {error}"))?;
    if !canonical_path.is_dir() {
        return Err("The selected path is not a directory".to_owned());
    }
    let path = canonical_path.to_string_lossy().into_owned();
    state.add_music_library_directory(&path)
}

#[tauri::command]
pub fn remove_music_library_directory(
    id: i64,
    state: tauri::State<'_, Database>,
) -> Result<(), String> {
    state.remove_music_library_directory(id)
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
pub fn get_album_artwork(
    album_artist: Option<String>,
    album: Option<String>,
    state: tauri::State<'_, Database>,
) -> Result<Option<TrackArtwork>, String> {
    state.get_album_artwork(album_artist, album)
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
pub fn create_playlist(name: String, state: tauri::State<'_, Database>) -> Result<i64, String> {
    state.create_playlist(&name)
}

#[tauri::command]
pub fn list_playlists(state: tauri::State<'_, Database>) -> Result<Vec<PlaylistSummary>, String> {
    state.list_playlists()
}

#[tauri::command]
pub fn list_playlist_tracks(
    playlist_id: i64,
    state: tauri::State<'_, Database>,
) -> Result<Vec<PlaylistTrackSummary>, String> {
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

#[cfg(test)]
mod tests {
    use super::{Database, TrackArtwork};
    use rusqlite::params;

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
