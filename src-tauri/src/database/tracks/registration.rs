use super::{details_from_row, Database, DETAILS_COLUMNS};
use crate::tracks::{discovery::DiscoveredFile, model::TrackRegistrationResult};
use rusqlite::params;
use std::path::Path;

impl Database {
    pub(crate) fn register_tracks(
        &self,
        files: Vec<DiscoveredFile>,
    ) -> Result<Vec<TrackRegistrationResult>, String> {
        let mut connection = self.connection()?;
        let mut transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut results = Vec::with_capacity(files.len());
        for file in files {
            if crate::tasks::cancelled() {
                break;
            }
            let path = match file {
                Ok(path) => path,
                Err(failure) => {
                    results.push(TrackRegistrationResult::Failed {
                        path: failure.path,
                        error: failure.error,
                    });
                    continue;
                }
            };
            let outcome =
                (|| {
                    let savepoint = transaction.savepoint().map_err(|error| error.to_string())?;
                    let title = Path::new(&path)
                        .file_stem()
                        .map(|name| name.to_string_lossy().into_owned());
                    let inserted = savepoint
                        .execute(
                            "INSERT INTO tracks (path, title) VALUES (?1, ?2)
                     ON CONFLICT(path) DO NOTHING",
                            params![path, title],
                        )
                        .map_err(|error| error.to_string())?
                        > 0;
                    let track = savepoint
                        .query_row(
                            &format!("SELECT {DETAILS_COLUMNS} FROM tracks WHERE path = ?1"),
                            [&path],
                            details_from_row,
                        )
                        .map_err(|error| error.to_string())?;
                    let needs_metadata: bool = savepoint
                        .query_row(
                            "SELECT NOT EXISTS (SELECT 1 FROM track_editing WHERE track_id = ?1)",
                            [track.id],
                            |row| row.get(0),
                        )
                        .map_err(|error| error.to_string())?;
                    if inserted {
                        savepoint.execute(
                        "INSERT OR IGNORE INTO track_artwork_pending (track_id) VALUES (?1)",
                        [track.id],
                    ).map_err(|error| error.to_string())?;
                    }
                    savepoint.commit().map_err(|error| error.to_string())?;
                    Ok::<_, String>(TrackRegistrationResult::Registered {
                        track: Box::new(track),
                        needs_metadata,
                    })
                })();
            results.push(
                outcome.unwrap_or_else(|error| TrackRegistrationResult::Failed { path, error }),
            );
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(results)
    }
}
