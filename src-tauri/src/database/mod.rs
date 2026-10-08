use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

mod artwork;
pub(crate) mod commands;
pub(crate) use artwork::ArtworkUpdate;
mod library;
pub(crate) mod lyrics;
mod metadata;
mod paths;
mod playlist;
mod schema;
mod skip;
#[cfg(test)]
mod tests;
pub(crate) mod write;

pub use playlist::PlaylistReorderError;

const SCHEMA: &str = include_str!("schema.sql");

pub struct Database {
    connection: Mutex<Connection>,
    #[cfg(test)]
    artwork_decodes: std::sync::atomic::AtomicUsize,
    skipped_tracks: Arc<RwLock<HashSet<i64>>>,
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
    disc_number: Option<i64>,
    track_number: Option<i64>,
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
    disc_total: Option<i64>,
    track_total: Option<i64>,
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

    pub(crate) fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }
    pub(crate) fn artist(&self) -> Option<&str> {
        self.artist.as_deref()
    }
    pub(crate) fn album(&self) -> Option<&str> {
        self.album.as_deref()
    }
    pub(crate) fn duration_ms(&self) -> Option<i64> {
        self.duration_ms
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibraryDirectory {
    pub(crate) id: i64,
    pub(crate) path: String,
    display_path: String,
}

pub struct TrackWriteInput {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub release_date: Option<String>,
    pub disc_number: Option<i64>,
    pub track_number: Option<i64>,
    pub disc_total: Option<i64>,
    pub track_total: Option<i64>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub sample_rate_hz: Option<i64>,
    pub bitrate_kbps: Option<i64>,
    pub channels: Option<i64>,
    pub artwork: Option<ArtworkContent>,
    pub editing: Option<String>,
    pub lyrics: Option<String>,
}

pub struct ArtworkContent {
    pub mime_type: String,
    pub image: Vec<u8>,
}

pub enum TrackWriteOutcome {
    Added,
    Updated,
}

#[derive(Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrackArtwork {
    Available { mime_type: String, data: Vec<u8> },
    NoArtwork,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        schema::initialize_schema(&mut connection)?;

        let skipped_tracks = {
            let mut statement = connection.prepare("SELECT track_id FROM skipped_tracks")?;
            let rows = statement.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<HashSet<_>>>()?
        };
        Ok(Self {
            connection: Mutex::new(connection),
            #[cfg(test)]
            artwork_decodes: std::sync::atomic::AtomicUsize::new(0),
            skipped_tracks: Arc::new(RwLock::new(skipped_tracks)),
        })
    }

    // Tauri's mock runtime retains managed state after its window/app is dropped.
    // Explicitly close the file connection so restart tests exercise a cold database.
    #[cfg(test)]
    pub(crate) fn close_test_connection(&self) {
        let mut connection = self.connection().unwrap();
        let previous = std::mem::replace(&mut *connection, Connection::open_in_memory().unwrap());
        previous.close().unwrap();
    }

    #[cfg(test)]
    pub(crate) fn artwork_decode_count(&self) -> usize {
        self.artwork_decodes
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    #[cfg(test)]
    pub(crate) fn observe_artwork_decode(&self) {
        self.artwork_decodes
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Database connection is unavailable".to_owned())
    }
}
