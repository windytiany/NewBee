mod paths;
pub(crate) mod scanning;
mod state;
#[cfg(test)]
use super::model::TrackWriteInput;

use super::{model::TrackWriteOutcome, Database};
use crate::artwork::model::TrackArtwork;
use crate::library::model::{
    AlbumSummary, ArtistSummary, LibraryGroup, LibraryGrouping, MusicLibraryDirectory,
};
use crate::settings::{AlbumSortBy, AlbumSortOrder};
use crate::tracks::model::TrackSummary;
use rusqlite::{params, OptionalExtension};

impl Database {
    pub(crate) fn external_track_ids(&self, track_ids: &[i64]) -> Result<Vec<i64>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT id FROM tracks WHERE id = ?1 AND in_library = 0")
            .map_err(|error| error.to_string())?;
        let mut seen = std::collections::HashSet::new();
        let mut ids = Vec::new();
        for id in track_ids.iter().filter(|id| seen.insert(**id)) {
            if let Some(id) = statement
                .query_row([id], |row| row.get(0))
                .optional()
                .map_err(|error| error.to_string())?
            {
                ids.push(id);
            }
        }
        Ok(ids)
    }

    pub(crate) fn library_track_paths(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT path FROM tracks WHERE in_library = 1")
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
                Ok(MusicLibraryDirectory { id, path })
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

    /// Import a snapshot into the library and clear its Inbox registration atomically.
    #[cfg(test)]
    pub(crate) fn upsert_track(
        &self,
        track: &TrackWriteInput,
        scan: Option<&crate::artwork::collection::Scan>,
    ) -> Result<TrackWriteOutcome, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let was_in_library: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tracks WHERE path = ?1 AND in_library = 1)",
                [&track.path],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let track_id = super::tracks::persist_track(&transaction, track, scan)?;
        transaction
            .execute("UPDATE tracks SET in_library = 1 WHERE id = ?1", [track_id])
            .map_err(|error| format!("Failed to grant library membership: {error}"))?;
        transaction
            .execute("DELETE FROM inbox WHERE track_id = ?1", [track_id])
            .map_err(|error| format!("Failed to remove imported path from inbox: {error}"))?;
        let outcome = if was_in_library {
            TrackWriteOutcome::Updated
        } else {
            TrackWriteOutcome::Added
        };
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(outcome)
    }

    pub(crate) fn import_snapshot(
        &self,
        snapshot: &crate::tracks::scanning::Snapshot,
    ) -> Result<TrackWriteOutcome, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let outcome = import_snapshot(&transaction, snapshot)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(outcome)
    }

    pub fn list_artists(&self, grouping: LibraryGrouping) -> Result<Vec<ArtistSummary>, String> {
        let column = grouping.column();
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT group_artist, COUNT(*)
                 FROM (
                     SELECT {column} AS group_artist, album_artist, album
                     FROM tracks
                     WHERE in_library = 1
                     GROUP BY {column}, album_artist, album
                 )
                 GROUP BY group_artist
                 ORDER BY group_artist IS NOT NULL, group_artist COLLATE NOCASE, group_artist",
            ))
            .map_err(|error| format!("Failed to prepare artist query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(ArtistSummary {
                    artist: row.get(0)?,
                    album_count: row.get(1)?,
                })
            })
            .map_err(|error| format!("Failed to list artists: {error}"))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("Failed to read artists: {error}"))
    }

    pub fn list_albums(
        &self,
        group: LibraryGroup,
        sort_by: AlbumSortBy,
        sort_order: AlbumSortOrder,
    ) -> Result<Vec<AlbumSummary>, String> {
        let column = group.grouping.column();
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
                "WITH grouped_albums AS (
                     SELECT DISTINCT album_artist AS group_album_artist, album AS group_album
                     FROM tracks
                     WHERE in_library = 1 AND {column} IS ?1
                 )
                 SELECT album, album_artist,
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
                 JOIN grouped_albums ON album_artist IS group_album_artist AND album IS group_album
                 WHERE in_library = 1
                 GROUP BY album_artist, album
                 ORDER BY {order_by}, album_artist IS NOT NULL, album_artist COLLATE NOCASE, album_artist",
            ))
            .map_err(|error| format!("Failed to prepare album query: {error}"))?;
        let rows = statement
            .query_map(params![group.artist], |row| {
                Ok(AlbumSummary {
                    album: row.get(0)?,
                    album_artist: row.get(1)?,
                    year: row.get(2)?,
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
        let track_id = self
            .connection()?
            .query_row(
                "SELECT t.id
                 FROM tracks t
                 INNER JOIN track_artwork ta ON ta.track_id = t.id AND ta.is_display = 1
                 WHERE t.in_library = 1 AND t.album_artist IS ?1 AND t.album IS ?2
                 ORDER BY t.disc_number IS NULL, t.disc_number,
                          t.track_number IS NULL, t.track_number, t.id
                 LIMIT 1",
                params![album_artist.as_deref(), album.as_deref()],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| {
                format!("Failed to get artwork for album {album:?} by {album_artist:?}: {error}")
            })?;
        match track_id {
            Some(track_id) => self.get_track_artwork(track_id),
            None => Ok(None),
        }
    }

    pub fn list_album_tracks(
        &self,
        album_artist: Option<String>,
        album: Option<String>,
        group: Option<LibraryGroup>,
    ) -> Result<Vec<TrackSummary>, String> {
        let filter = group.as_ref().map_or_else(String::new, |group| {
            format!(" AND {} IS ?3", group.grouping.column())
        });
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT id, title, artist, album, duration_ms, disc_number, track_number
                 FROM tracks
                 WHERE in_library = 1 AND album_artist IS ?1 AND album IS ?2{filter}
                 ORDER BY disc_number IS NULL, disc_number,
                          track_number IS NULL, track_number, id",
            ))
            .map_err(|error| format!("Failed to prepare album track query: {error}"))?;
        let mut parameters = vec![album_artist, album];
        if let Some(group) = group {
            parameters.push(group.artist);
        }
        let rows = statement
            .query_map(rusqlite::params_from_iter(parameters), |row| {
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
    pub fn remove_track_from_library(&self, track_id: i64) -> Result<(), String> {
        let connection = self.connection()?;
        let removed = connection
            .execute(
                "UPDATE tracks SET in_library = 0 WHERE id = ?1 AND in_library = 1",
                [track_id],
            )
            .map_err(|error| format!("Failed to remove track {track_id} from library: {error}"))?;
        if removed == 0 {
            return Err(format!("Track {track_id} was not found"));
        }
        Ok(())
    }
}

fn import_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    snapshot: &crate::tracks::scanning::Snapshot,
) -> Result<TrackWriteOutcome, String> {
    let existing: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tracks WHERE path = ?1 AND in_library = 1)",
            [&snapshot.track.path],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let before = if existing {
        Some(state::State::read(transaction, &snapshot.track.path)?)
    } else {
        None
    };
    transaction
        .execute_batch("SAVEPOINT scan_content")
        .map_err(|error| error.to_string())?;
    let id = crate::tracks::scanning::persist(transaction, snapshot)?;
    let outcome = match before {
        Some(before) if before == state::State::read(transaction, &snapshot.track.path)? => {
            // A changed file timestamp is not itself a metadata change.
            transaction
                .execute_batch("ROLLBACK TO scan_content")
                .map_err(|error| error.to_string())?;
            TrackWriteOutcome::Unchanged
        }
        Some(_) => TrackWriteOutcome::Updated,
        None => TrackWriteOutcome::Added,
    };
    transaction
        .execute_batch("RELEASE scan_content")
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE tracks SET in_library = 1 WHERE id = ?1 AND in_library != 1",
            [id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM inbox WHERE track_id = ?1", [id])
        .map_err(|error| error.to_string())?;
    Ok(outcome)
}
