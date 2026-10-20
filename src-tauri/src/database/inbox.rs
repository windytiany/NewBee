use super::Database;
use crate::tracks::model::Snapshot;

impl Database {
    #[cfg(test)]
    pub(crate) fn inbox_paths(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT t.path FROM inbox i JOIN tracks t ON t.id = i.track_id ORDER BY i.rowid",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn inbox_entries(&self) -> Result<Vec<(i64, i64)>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT track_id, added_at FROM inbox ORDER BY rowid")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn save_inbox_snapshot(&self, snapshot: &Snapshot) -> Result<i64, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let id = super::tracks::persistence::persist(&transaction, snapshot)?;
        transaction.execute("INSERT OR IGNORE INTO inbox(track_id, added_at) VALUES (?1, CAST(unixepoch('subsec') * 1000 AS INTEGER))", [id])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("UPDATE tracks SET in_library = 0 WHERE id = ?1", [id])
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(id)
    }

    pub(crate) fn remove_inbox_track(&self, id: i64) -> Result<(), String> {
        self.connection()?
            .execute("DELETE FROM inbox WHERE track_id = ?1", [id])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}
