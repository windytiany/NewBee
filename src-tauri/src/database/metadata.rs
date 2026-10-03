use super::Database;
use crate::metadata::model::{MetadataChange, MetadataField};
use rusqlite::params;

impl Database {
    /// Do not touch technical properties, artwork, IDs, skipped state or playlist references.
    pub(crate) fn update_track_metadata(
        &self,
        track_id: i64,
        changes: &[MetadataChange],
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for change in changes {
            // Lyrics live only in the audio file, not in the library database.
            if change.field == MetadataField::Lyrics {
                continue;
            }
            let sql = format!(
                "UPDATE tracks SET {} = ?1 WHERE id = ?2",
                change.field.column()
            );
            let count = transaction
                .execute(&sql, params![change.value, track_id])
                .map_err(|error| format!("更新数据库失败：{error}"))?;
            if count == 0 {
                return Err(format!("曲目 {track_id} 已不在数据库中"));
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("提交数据库更新失败：{error}"))
    }
}
