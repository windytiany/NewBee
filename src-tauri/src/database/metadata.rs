use super::{Database, EmbeddedArtwork};
use crate::metadata::model::{LyricsMarkAction, MetadataChange, MetadataField};
use rusqlite::params;

impl Database {
    pub(crate) fn record_scan_issue(&self, path: &str, issue: &str) -> Result<(), String> {
        self.connection()?.execute(
            "UPDATE track_editing SET scan_issue = ?2 WHERE track_id = (SELECT id FROM tracks WHERE path = ?1)",
            params![path, issue],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn get_editing_snapshot(
        &self,
        track_id: i64,
    ) -> Result<crate::metadata::files::EditingSnapshot, String> {
        let (snapshot, scan_issue): (String, Option<String>) = self
            .connection()?
            .query_row(
                "SELECT snapshot, scan_issue FROM track_editing WHERE track_id = ?1",
                [track_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| format!("读取编辑能力失败：{error}"))?;
        let mut metadata: crate::metadata::files::EditingSnapshot = serde_json::from_str(&snapshot)
            .map_err(|error| format!("无效编辑能力快照：{error}"))?;
        if scan_issue.is_some() {
            metadata.issue = scan_issue;
        }
        Ok(metadata)
    }

    /// Synchronize confirmed file content and requested database actions atomically.
    /// Preserve IDs, skipped state and playlist references.
    pub(crate) fn update_metadata_cover_and_lyrics(
        &self,
        track_id: i64,
        changes: &[MetadataChange],
        cover: Option<&EmbeddedArtwork>,
        action: LyricsMarkAction,
        confirmed: Option<&super::TrackWriteInput>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        if let Some(confirmed) = confirmed {
            super::library::persist_track(&transaction, confirmed)?;
        }
        for change in changes {
            if change.field == MetadataField::Lyrics {
                transaction.execute(
                    "INSERT INTO track_lyrics (track_id, text) VALUES (?1, ?2)
                     ON CONFLICT(track_id) DO UPDATE SET text = excluded.text,
                        no_lyrics = CASE WHEN excluded.text IS NOT NULL THEN 0 ELSE track_lyrics.no_lyrics END",
                    params![track_id, change.value],
                ).map_err(|error| format!("同步歌词失败：{error}"))?;
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
        if action != LyricsMarkAction::Keep {
            transaction
                .execute(
                    "INSERT INTO track_lyrics (track_id, no_lyrics) VALUES (?1, ?2)
                 ON CONFLICT(track_id) DO UPDATE SET no_lyrics = excluded.no_lyrics,
                    text = CASE WHEN excluded.no_lyrics = 1 THEN NULL ELSE track_lyrics.text END",
                    params![track_id, action == LyricsMarkAction::Mark],
                )
                .map_err(|error| format!("更新无歌词标记失败：{error}"))?;
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
