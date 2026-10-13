use crate::database::Database;
use crate::metadata::files;
use std::path::Path;

pub(super) fn reread(
    database: &Database,
    track_id: i64,
) -> Result<super::model::TrackReadResult, String> {
    let track = database
        .get_track(track_id)?
        .ok_or_else(|| format!("曲目 {track_id} 已不在数据库中"))?;
    database.begin_track_inspection(track_id)?;
    let path = Path::new(track.path());
    let snapshot =
        files::read_track_collection(path)?.ok_or_else(|| "文件格式不支持快照".to_owned())?;
    let confirmed = snapshot.track;
    let scan = crate::artwork::collection::Scan {
        embedded: snapshot.embedded,
        directory: files::artwork::read_directory_pictures(path),
    };
    let mut connection = database.connection()?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let id = crate::database::tracks::persist_track(&transaction, &confirmed, Some(&scan))?;
    if id != track_id {
        return Err("曲目路径已改变，请重试".to_owned());
    }
    let issues = scan.issues();
    let issue = (!issues.is_empty()).then(|| issues.join("; "));
    if let Some(issue) = &issue {
        transaction
            .execute(
                "UPDATE track_editing SET scan_issue = ?2 WHERE track_id = ?1",
                rusqlite::params![track_id, issue],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(super::model::TrackReadResult {
        track_id,
        database_updated: true,
        error: issue,
    })
}
