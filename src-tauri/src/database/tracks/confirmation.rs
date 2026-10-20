use crate::database::Database;
use crate::metadata::model::EditingSnapshot;
use crate::tracks::model::TrackReadResult;
use rusqlite::params;

pub(crate) struct Confirmation {
    pub(crate) id: i64,
    pub(crate) revision: i64,
    pub(crate) path: String,
    pub(crate) snapshot: Result<crate::tracks::model::Snapshot, String>,
}

impl Database {
    pub(crate) fn pending_track(&self, id: i64) -> Result<Option<(String, i64)>, String> {
        use rusqlite::OptionalExtension;
        self.connection()?.query_row(
            "SELECT path, metadata_revision FROM tracks WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM track_editing WHERE track_id = ?1)",
            [id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|error| error.to_string())
    }

    pub(crate) fn begin_track_inspection(&self, id: i64) -> Result<(), String> {
        let count = self
            .connection()?
            .execute(
                "UPDATE tracks SET metadata_revision = metadata_revision + 1 WHERE id = ?1",
                [id],
            )
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err(format!("曲目 {id} 已不在数据库中"));
        }
        Ok(())
    }

    pub(crate) fn pending_track_ids(&self) -> Result<Vec<i64>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id FROM tracks WHERE NOT EXISTS (SELECT 1 FROM track_editing WHERE track_id = tracks.id) ORDER BY id",
        ).map_err(|error| error.to_string())?;
        let ids = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        Ok(ids)
    }

    pub(crate) fn confirm_tracks(
        &self,
        batch: Vec<Confirmation>,
    ) -> Result<Vec<TrackReadResult>, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut results = Vec::new();
        for item in batch {
            let pending: bool = transaction.query_row(
                "SELECT EXISTS (SELECT 1 FROM tracks WHERE id = ?1 AND path = ?2 AND metadata_revision = ?3 AND NOT EXISTS (SELECT 1 FROM track_editing WHERE track_id = ?1))",
                params![item.id, item.path, item.revision], |row| row.get(0),
            ).map_err(|error| error.to_string())?;
            if !pending {
                continue;
            }
            transaction
                .execute_batch("SAVEPOINT confirm_target")
                .map_err(|error| error.to_string())?;
            let publication = (|| -> Result<Option<String>, String> {
                let savepoint = &transaction;
                let error = match item.snapshot {
                    Ok(snapshot) => {
                        super::persistence::persist(savepoint, &snapshot)?;
                        None
                    }
                    Err(error) => {
                        let snapshot = EditingSnapshot {
                            file_type: String::new(),
                            tag_types: Vec::new(),
                            writable_fields: Vec::new(),
                            issue: Some(error.clone()),
                            values: Default::default(),
                        };
                        savepoint.execute("INSERT INTO track_editing (track_id, snapshot, scan_issue) VALUES (?1, ?2, ?3)",
                        params![item.id, serde_json::to_string(&snapshot).map_err(|error| error.to_string())?, error])
                        .map_err(|error| error.to_string())?;
                        Some(error)
                    }
                };
                Ok(error)
            })();
            let (database_updated, error) = match publication {
                Ok(error) => (true, error),
                Err(error) => {
                    transaction
                        .execute_batch("ROLLBACK TO confirm_target")
                        .map_err(|error| error.to_string())?;
                    log::warn!("Could not confirm track {}: {error}", item.id);
                    (false, Some(error))
                }
            };
            transaction
                .execute_batch("RELEASE confirm_target")
                .map_err(|error| error.to_string())?;
            results.push(TrackReadResult {
                track_id: item.id,
                database_updated,
                error,
            });
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(results)
    }
}
