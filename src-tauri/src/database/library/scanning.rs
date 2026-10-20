use super::super::Database;
use crate::tracks::model::{Snapshot, TrackWriteOutcome};
use std::collections::HashMap;

#[derive(Default)]
pub(crate) struct ScanState {
    pub(crate) fingerprint: Option<String>,
    pub(crate) linked: Vec<(i64, String)>,
}

impl Database {
    pub(crate) fn scan_states(&self) -> Result<HashMap<String, ScanState>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT t.path, CASE WHEN t.in_library = 1
                 AND t.metadata_revision = s.metadata_revision
                 AND e.scan_issue IS NULL
                 AND NOT EXISTS (SELECT 1 FROM track_artwork_pending p WHERE p.track_id = t.id)
                 THEN s.fingerprint END
             FROM tracks t LEFT JOIN track_scan s ON s.track_id = t.id
             LEFT JOIN track_editing e ON e.track_id = t.id",
            )
            .map_err(|error| error.to_string())?;
        let mut states = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ScanState {
                        fingerprint: row.get(1)?,
                        linked: Vec::new(),
                    },
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<HashMap<_, _>>>()
            .map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT t.path, a.id, s.source_path FROM tracks t
             JOIN track_artwork a ON a.track_id = t.id
             JOIN track_artwork_sources s ON s.artwork_id = a.id
             WHERE s.source_kind = 'manual' ORDER BY a.id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        for row in rows {
            let (path, id, source) = row.map_err(|error| error.to_string())?;
            states.entry(path).or_default().linked.push((id, source));
        }
        Ok(states)
    }

    pub(crate) fn import_scanned_snapshots(
        &self,
        snapshots: &[(Snapshot, Option<String>)],
    ) -> Result<Vec<Result<TrackWriteOutcome, String>>, String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut outcomes = Vec::with_capacity(snapshots.len());
        for (snapshot, fingerprint) in snapshots {
            transaction
                .execute_batch("SAVEPOINT scan_track")
                .map_err(|error| error.to_string())?;
            let outcome = persist(&transaction, snapshot, fingerprint.as_deref());
            if outcome.is_err() {
                transaction
                    .execute_batch("ROLLBACK TO scan_track")
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute_batch("RELEASE scan_track")
                .map_err(|error| error.to_string())?;
            outcomes.push(outcome);
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(outcomes)
    }
}

fn persist(
    transaction: &rusqlite::Transaction<'_>,
    snapshot: &Snapshot,
    fingerprint: Option<&str>,
) -> Result<TrackWriteOutcome, String> {
    let outcome = super::import_snapshot(transaction, snapshot)?;
    if let Some(fingerprint) = fingerprint {
        transaction
            .execute(
                "INSERT INTO track_scan (track_id, metadata_revision, fingerprint)
                 SELECT id, metadata_revision, ?2 FROM tracks WHERE path = ?1
                 ON CONFLICT(track_id) DO UPDATE SET metadata_revision = excluded.metadata_revision,
                 fingerprint = excluded.fingerprint",
                rusqlite::params![snapshot.track.path, fingerprint],
            )
            .map_err(|error| error.to_string())?;
    } else {
        transaction
            .execute(
                "DELETE FROM track_scan WHERE track_id = (SELECT id FROM tracks WHERE path = ?1)",
                [&snapshot.track.path],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(outcome)
}
