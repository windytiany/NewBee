use super::model::{InboxRead, InboxTrack};
use crate::database::Database;

pub(super) fn refresh(database: &Database) -> Result<InboxRead, String> {
    let mut tracks = Vec::new();
    for (id, added_at) in database.inbox_entries()? {
        let track = database
            .get_track(id)?
            .ok_or_else(|| format!("曲目 {id} 已不在数据库中"))?;
        tracks.push(InboxTrack { track, added_at });
    }
    Ok(InboxRead {
        tracks,
        failures: Vec::new(),
    })
}
