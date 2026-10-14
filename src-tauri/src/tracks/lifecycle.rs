use crate::{database::Database, locking::write::WriteState};
use rusqlite::{OptionalExtension, TransactionBehavior};
use std::collections::HashSet;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Default)]
pub(crate) struct References {
    pub(crate) ids: Vec<i64>,
    pub(crate) paths: Vec<String>,
}

pub(crate) fn resume<R: Runtime>(app: &AppHandle<R>, restored: Result<References, &str>) {
    cleanup(
        &app.state::<Database>(),
        &app.state::<WriteState>(),
        restored,
    );
    super::scheduling::initialize(app);
}

/// Startup only: the session worker has restored all references but has not
/// accepted commands, and the background scheduler has not been initialized.
/// The write gate also excludes foreground registration and metadata editing.
fn cleanup(database: &Database, write: &WriteState, restored: Result<References, &str>) {
    let references = match restored {
        Ok(references) => references,
        Err(reason) => {
            log::warn!("event=track_cleanup_skipped reason={reason}");
            return;
        }
    };
    let result = (|| {
        let _guard = write.acquire()?;
        collect(database, references)
    })();
    match result {
        Ok(deleted) => {
            log::info!("event=track_cleanup_completed deleted={deleted}");
            if deleted > 0 {
                if let Err(error) = database.clean_artwork_cache() {
                    log::warn!("event=track_cleanup_cache_failed error={error}");
                }
            }
        }
        Err(error) => log::warn!("event=track_cleanup_skipped reason={error}"),
    }
}

fn collect(database: &Database, references: References) -> Result<usize, String> {
    let mut connection = database.connection()?;
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
    let skipped = database.skipped_tracks();
    let mut skipped = skipped
        .write()
        .map_err(|_| "Track skip state is unavailable".to_owned())?;
    transaction.commit().map_err(|error| error.to_string())?;
    for id in &deleted {
        skipped.remove(id);
    }
    Ok(deleted.len())
}

#[cfg(test)]
mod tests;
