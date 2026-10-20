use crate::database::Database;
use std::path::Path;

pub(crate) fn reread(
    database: &Database,
    track_id: i64,
) -> Result<super::model::TrackReadResult, String> {
    let track = database
        .get_track(track_id)?
        .ok_or_else(|| format!("曲目 {track_id} 已不在数据库中"))?;
    let outcome = (|| {
        let snapshot = super::inspect(database, Path::new(track.path()))?;
        database.refresh_track(track_id, &snapshot)?;
        Ok(super::model::TrackReadResult {
            track_id,
            database_updated: true,
            error: None,
        })
    })();
    if let Err(error) = &outcome {
        log::warn!(
            "Reread {track_id} '{}' failed during scan/publication: {error}",
            track.path()
        );
    }
    outcome
}
