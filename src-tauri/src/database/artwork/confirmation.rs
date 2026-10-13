use crate::artwork::collection::Scan;
use crate::database::Database;
use rusqlite::params;

impl Database {
    pub(crate) fn confirm_track_artwork(
        &self,
        track_id: i64,
        path: &str,
        scan: &Scan,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let pending: bool = transaction.query_row(
            "SELECT EXISTS (SELECT 1 FROM tracks JOIN track_artwork_pending ON track_id = tracks.id WHERE tracks.id = ?1 AND path = ?2)",
            params![track_id, path], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if !pending {
            return Ok(());
        }
        super::synchronization::sync(&transaction, track_id, path, scan)?;
        transaction
            .execute(
                "DELETE FROM track_artwork_pending WHERE track_id = ?1",
                [track_id],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())
    }
}
