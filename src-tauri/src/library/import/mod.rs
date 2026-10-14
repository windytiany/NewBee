use crate::database::{model::TrackWriteOutcome, Database};
use serde::Serialize;
use std::path::Path;

pub(crate) mod directory;
pub(crate) mod files;
#[cfg(test)]
pub(crate) mod tests;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    added: u64,
    updated: u64,
    skipped: u64,
    pub(crate) failed: u64,
}

pub(crate) fn import_track(database: &Database, path: &Path, result: &mut ImportResult) {
    match crate::tracks::scanning::scan(database, path)
        .and_then(|snapshot| database.import_snapshot(&snapshot))
    {
        Ok(TrackWriteOutcome::Added) => result.added += 1,
        Ok(TrackWriteOutcome::Updated) => result.updated += 1,
        Err(error) => record_failure(database, result, path, &error),
    }
}

fn record_failure(_database: &Database, result: &mut ImportResult, path: &Path, error: &str) {
    result.failed += 1;
    log::warn!("Failed to scan '{}': {error}", path.display());
}
