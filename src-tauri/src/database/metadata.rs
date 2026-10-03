use super::{Database, EmbeddedArtwork};
use crate::metadata::model::{MetadataChange, MetadataField};
use rusqlite::params;

impl Database {
    /// Do not touch technical properties, artwork, IDs, skipped state or playlist references.
    pub(crate) fn update_track_metadata(
        &self,
        track_id: i64,
        changes: &[MetadataChange],
    ) -> Result<(), String> {
        self.update_metadata_and_cover(track_id, changes, None)
    }

    pub(crate) fn update_metadata_and_cover(
        &self,
        track_id: i64,
        changes: &[MetadataChange],
        cover: Option<&EmbeddedArtwork>,
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
        if let Some(cover) = cover {
            transaction.execute(
                "INSERT INTO track_artwork (track_id, mime_type, image) VALUES (?1, ?2, ?3)
                 ON CONFLICT(track_id) DO UPDATE SET mime_type = excluded.mime_type, image = excluded.image",
                params![track_id, &cover.mime_type, &cover.image],
            ).map_err(|error| format!("更新封面失败：{error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("提交数据库更新失败：{error}"))
    }
}
