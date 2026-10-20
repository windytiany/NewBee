use crate::database::{model::TrackWriteOutcome, Database};
use serde::Serialize;
use std::path::Path;

pub(crate) mod directory;
mod error;
pub(crate) mod files;
#[cfg(test)]
pub(crate) mod tests;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub(crate) added: u64,
    pub(crate) updated: u64,
    skipped: u64,
    pub(crate) failed: u64,
    #[serde(skip)]
    failures: crate::logging::aggregation::Failures,
}

impl Default for ImportResult {
    fn default() -> Self {
        Self {
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            failures: crate::logging::aggregation::Failures::new("library.import"),
        }
    }
}

pub(crate) fn import_track(database: &Database, path: &Path, result: &mut ImportResult) {
    let snapshot = match crate::tracks::scanning::scan(database, path) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            record_failure_at(result, path, "inspection", &error);
            return;
        }
    };
    match database.import_snapshot(&snapshot) {
        Ok(TrackWriteOutcome::Added) => result.added += 1,
        Ok(TrackWriteOutcome::Updated) => result.updated += 1,
        Ok(TrackWriteOutcome::Unchanged) => {}
        Err(error) => record_failure_at(result, path, "database", &error),
    }
}

fn record_failure(_database: &Database, result: &mut ImportResult, path: &Path, error: &str) {
    record_failure_at(result, path, "discovery", error);
}

fn record_failure_at(result: &mut ImportResult, path: &Path, stage: &str, error: &str) {
    result.failed += 1;
    result
        .failures
        .record(stage, error, &path.to_string_lossy());
}
