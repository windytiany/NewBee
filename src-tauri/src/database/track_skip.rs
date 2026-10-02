use super::Database;
use std::collections::HashSet;
use std::sync::{Arc, RwLock};

impl Database {
    pub fn list_skipped_track_ids(&self) -> Result<Vec<i64>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT track_id FROM skipped_tracks ORDER BY track_id")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    pub fn set_tracks_skipped(&self, track_ids: &[i64], skipped: bool) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for track_id in track_ids.iter().copied().collect::<HashSet<_>>() {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)",
                    [track_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if !exists {
                return Err(format!("Track {track_id} was not found"));
            }
            transaction
                .execute(
                    if skipped {
                        "INSERT OR IGNORE INTO skipped_tracks (track_id) VALUES (?1)"
                    } else {
                        "DELETE FROM skipped_tracks WHERE track_id = ?1"
                    },
                    [track_id],
                )
                .map_err(|error| error.to_string())?;
        }
        // Serialize committing the preference with the audio source's transition check.
        let mut skipped_tracks = self
            .skipped_tracks
            .write()
            .map_err(|_| "Track skip state is unavailable")?;
        transaction.commit().map_err(|error| error.to_string())?;
        for track_id in track_ids {
            if skipped {
                skipped_tracks.insert(*track_id);
            } else {
                skipped_tracks.remove(track_id);
            }
        }
        Ok(())
    }

    pub(crate) fn skipped_tracks(&self) -> Arc<RwLock<HashSet<i64>>> {
        Arc::clone(&self.skipped_tracks)
    }
}
