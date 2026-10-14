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
        let snapshot = super::scanning::scan(database, Path::new(track.path()))?;
        let mut connection = database.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let id = super::scanning::persist(&transaction, &snapshot)?;
        if id != track_id {
            return Err("曲目路径已改变，请重试".to_owned());
        }
        transaction.commit().map_err(|error| error.to_string())?;
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
