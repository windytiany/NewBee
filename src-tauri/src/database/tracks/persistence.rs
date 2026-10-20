use crate::{database::Database, tracks::model::Snapshot};

pub(in crate::database) fn persist(
    transaction: &rusqlite::Transaction<'_>,
    snapshot: &Snapshot,
) -> Result<i64, String> {
    let id = super::persist_track(transaction, &snapshot.track, Some(&snapshot.artwork))?;
    for (artwork_id, content) in &snapshot.linked {
        crate::database::artwork::update_linked_snapshot(transaction, id, *artwork_id, content)?;
    }
    Ok(id)
}

impl Database {
    pub(crate) fn refresh_track(&self, track_id: i64, snapshot: &Snapshot) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let id = persist(&transaction, snapshot)?;
        if id != track_id {
            return Err("曲目路径已改变，请重试".to_owned());
        }
        transaction.commit().map_err(|error| error.to_string())
    }
}
