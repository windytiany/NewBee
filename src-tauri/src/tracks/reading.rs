use crate::database::{ArtworkUpdate, Database};
use crate::metadata::files;
use std::path::Path;

pub(super) fn reread(database: &Database, track_id: i64) -> Result<(), String> {
    let track = database
        .get_track(track_id)?
        .ok_or_else(|| format!("曲目 {track_id} 已不在数据库中"))?;
    database.begin_track_inspection(track_id)?;
    let mut confirmed = files::read_track(Path::new(track.path()))?
        .ok_or_else(|| "文件格式不支持快照".to_owned())?;
    let artwork = if confirmed.artwork.is_none() {
        match files::artwork::read_directory_cover(Path::new(track.path()))? {
            Some((cover, source)) => {
                confirmed.artwork = Some(cover);
                ArtworkUpdate::Directory(source.to_string_lossy().into_owned())
            }
            None => ArtworkUpdate::Embedded,
        }
    } else {
        ArtworkUpdate::Embedded
    };
    let mut connection = database.connection()?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let id = crate::database::tracks::persist_track(&transaction, &confirmed, &artwork)?;
    if id != track_id {
        return Err("曲目路径已改变，请重试".to_owned());
    }
    transaction.commit().map_err(|error| error.to_string())
}
