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
    match crate::metadata::files::read_track(path) {
        Ok(Some(mut track)) => {
            let fallback = if track.artwork.is_none() {
                crate::metadata::files::artwork::read_directory_cover(path)
            } else {
                Ok(None)
            };
            let (source, issue) = match fallback {
                Ok(Some((artwork, source))) => {
                    track.artwork = Some(artwork);
                    (
                        crate::database::ArtworkUpdate::Directory(
                            source.to_string_lossy().into_owned(),
                        ),
                        None,
                    )
                }
                Ok(None) => (crate::database::ArtworkUpdate::Embedded, None),
                Err(error) => (crate::database::ArtworkUpdate::Preserve, Some(error)),
            };
            match database.upsert_track(&track, source) {
                Ok(TrackWriteOutcome::Added) => result.added += 1,
                Ok(TrackWriteOutcome::Updated) => result.updated += 1,
                Err(error) => record_failure(database, result, path, &error),
            }
            if let Some(issue) = issue {
                record_failure(database, result, path, &issue);
            }
        }
        Ok(None) => result.skipped += 1,
        Err(error) => record_failure(database, result, path, &error),
    }
}

fn record_failure(database: &Database, result: &mut ImportResult, path: &Path, error: &str) {
    result.failed += 1;
    if let Err(error) = database.record_scan_issue(&path.to_string_lossy(), error) {
        log::warn!(
            "Could not persist scan issue for '{}': {error}",
            path.display()
        );
    }
    log::warn!("Failed to scan '{}': {error}", path.display());
}
