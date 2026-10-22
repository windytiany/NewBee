use super::model::FileResult;
use crate::database::Database;
use std::path::Path;

pub(super) fn ingest(database: &Database, track_ids: Vec<i64>) -> Vec<FileResult> {
    track_ids
        .into_iter()
        .take_while(|_| !crate::tasks::cancelled())
        .map(|id| {
            let mut path = String::new();
            let outcome = (|| {
                if !database
                    .inbox_entries()?
                    .iter()
                    .any(|(candidate, _)| *candidate == id)
                {
                    return Err("曲目不在 Inbox 中".to_owned());
                }
                let track = database
                    .get_track(id)?
                    .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
                path = track.path;
                let snapshot = crate::tracks::inspect(database, Path::new(&path))?;
                database.import_snapshot(&snapshot).map(|_| ())
            })();
            if let Err(error) = &outcome {
                log::warn!(
                    "Inbox ingest {id} '{}' failed during scan/publication: {error}",
                    path
                );
            }
            FileResult {
                track_id: Some(id),
                path,
                success: outcome.is_ok(),
                skipped: false,
                error: outcome.err(),
            }
        })
        .collect()
}
