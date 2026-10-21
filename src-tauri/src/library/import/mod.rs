use crate::database::Database;
use crate::library::model::ImportResult;
use crate::tracks::model::TrackWriteOutcome;
use std::path::Path;

pub(crate) mod files;
#[cfg(test)]
mod tests;

pub(crate) fn import_track(database: &Database, path: &Path, result: &mut ImportResult) {
    let snapshot = match crate::tracks::inspect(database, path) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            result.record_failure(path, "inspection", &error);
            return;
        }
    };
    match database.import_snapshot(&snapshot) {
        Ok(TrackWriteOutcome::Added) => result.added += 1,
        Ok(TrackWriteOutcome::Updated) => result.updated += 1,
        Ok(TrackWriteOutcome::Unchanged) => {}
        Err(error) => result.record_failure(path, "database", &error),
    }
}
