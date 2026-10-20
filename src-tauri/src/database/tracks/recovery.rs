use crate::{database::Database, tracks::model::References};
use rusqlite::{OptionalExtension, TransactionBehavior};
use std::collections::HashSet;

impl Database {
    pub(crate) fn collect_orphan_tracks(&self, references: References) -> Result<usize, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut protected: HashSet<_> = references.ids.into_iter().collect();
        for path in references.paths {
            // Resolve persisted playback paths against registration, never the file
            // system. An unresolved identity makes this startup unsafe to collect.
            let id = transaction
                .query_row("SELECT id FROM tracks WHERE path = ?1", [&path], |row| {
                    row.get::<_, i64>(0)
                })
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "unresolved_playback_path".to_owned())?;
            protected.insert(id);
        }
        let candidates = {
            let mut statement = transaction
                .prepare(
                    "SELECT id FROM tracks WHERE in_library = 0
                     AND NOT EXISTS (SELECT 1 FROM inbox WHERE track_id = tracks.id)
                     AND NOT EXISTS (SELECT 1 FROM playlist_items WHERE track_id = tracks.id)
                     ORDER BY id",
                )
                .map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, i64>(0))
                .map_err(|error| error.to_string())?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| error.to_string())?
        };
        let mut deleted = Vec::new();
        for id in candidates {
            if !protected.contains(&id) {
                transaction
                    .execute("DELETE FROM tracks WHERE id = ?1", [id])
                    .map_err(|error| error.to_string())?;
                deleted.push(id);
            }
        }
        let skipped = self.skipped_tracks();
        let mut skipped = skipped
            .write()
            .map_err(|_| "Track skip state is unavailable".to_owned())?;
        transaction.commit().map_err(|error| error.to_string())?;
        for id in &deleted {
            skipped.remove(id);
        }
        Ok(deleted.len())
    }
}
