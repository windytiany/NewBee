use super::model::FileResult;
use crate::{database::Database, tracks::discovery};

pub(crate) fn register(database: &Database, paths: Vec<String>) -> Vec<FileResult> {
    paths
        .into_iter()
        .map(|path| {
            let outcome = (|| {
                let canonical = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
                if !crate::tracks::has_supported_extension(&canonical) {
                    return Err("不支持的音频文件".to_owned());
                }
                let snapshot = crate::tracks::inspect(database, &canonical)?;
                database.save_inbox_snapshot(&snapshot)
            })();
            if let Err(error) = &outcome {
                log::warn!(
                    "Inbox registration '{}' failed during scan/publication: {error}",
                    path
                );
            }
            FileResult {
                track_id: outcome.as_ref().ok().copied(),
                path,
                success: outcome.is_ok(),
                skipped: false,
                error: outcome.err(),
            }
        })
        .collect()
}

pub(super) fn register_directories(database: &Database, paths: Vec<String>) -> Vec<FileResult> {
    let mut files = Vec::new();
    let mut results = Vec::new();
    for entry in discovery::discover_directories(&paths) {
        match entry {
            Ok(path) => files.push(path),
            Err(failure) => results.push(FileResult {
                track_id: None,
                path: failure.path,
                success: false,
                skipped: false,
                error: Some(failure.error),
            }),
        }
    }
    results.extend(register(database, files));
    results
}
