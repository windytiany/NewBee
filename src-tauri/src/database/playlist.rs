use super::{Database, PlaylistSummary, PlaylistTrackSummary};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum PlaylistReorderError {
    ItemSetMismatch { message: String },
    Failed { message: String },
}

impl From<String> for PlaylistReorderError {
    fn from(message: String) -> Self {
        Self::Failed { message }
    }
}

impl Database {
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
    ) -> Result<(), PlaylistReorderError> {
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
            return Err(format!("Playlist {playlist_id} was not found").into());
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
            return Err("Playlist item IDs must not contain duplicates"
                .to_owned()
                .into());
        }
        if ordered_ids != current_ids {
            return Err(PlaylistReorderError::ItemSetMismatch {
                message: format!(
                    "Ordered playlist item IDs must exactly match playlist {playlist_id}"
                ),
            });
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
                )
                .into());
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
}
