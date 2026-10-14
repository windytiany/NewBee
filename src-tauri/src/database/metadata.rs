use super::Database;
use crate::artwork::model::ArtworkContent;
use crate::metadata::model::{LyricsMarkAction, MetadataChange, MetadataField};
use rusqlite::params;

fn track_column(field: MetadataField) -> Option<&'static str> {
    Some(match field {
        MetadataField::Title => "title",
        MetadataField::Artist => "artist",
        MetadataField::Album => "album",
        MetadataField::AlbumArtist => "album_artist",
        MetadataField::ReleaseDate => "release_date",
        MetadataField::TrackNumber => "track_number",
        MetadataField::DiscNumber => "disc_number",
        MetadataField::TrackTotal => "track_total",
        MetadataField::DiscTotal => "disc_total",
        _ => return None,
    })
}

impl Database {
    #[cfg(test)]
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
    ) -> Result<crate::metadata::model::EditingSnapshot, String> {
        let (snapshot, scan_issue): (String, Option<String>) = self
            .connection()?
            .query_row(
                "SELECT snapshot, scan_issue FROM track_editing WHERE track_id = ?1",
                [track_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| format!("读取编辑能力失败：{error}"))?;
        let mut metadata: crate::metadata::model::EditingSnapshot = serde_json::from_str(&snapshot)
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
        cover: Option<Option<&ArtworkContent>>,
        artwork: Option<&crate::artwork::collection::Draft>,
        action: LyricsMarkAction,
        confirmed: Option<&super::model::TrackWriteInput>,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        if let Some(confirmed) = confirmed {
            super::tracks::persist_track(&transaction, confirmed, None)?;
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
            let Some(column) = track_column(change.field) else {
                continue;
            };
            let sql = format!("UPDATE tracks SET {column} = ?1 WHERE id = ?2");
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
        if let Some(Some(cover)) = cover {
            super::artwork::collection::add_cover(
                &transaction,
                track_id,
                cover,
                confirmed.map(|track| track.path.as_str()),
            )?;
        }
        if matches!(cover, Some(None)) {
            transaction
                .execute(
                    "DELETE FROM track_artwork WHERE track_id = ?1 AND is_display = 1",
                    [track_id],
                )
                .map_err(|error| error.to_string())?;
            super::artwork::synchronization::select_display(&transaction, track_id)?;
        }
        if let Some(draft) = artwork {
            super::artwork::collection::save(&transaction, track_id, draft)?;
        }
        transaction
            .commit()
            .map_err(|error| format!("提交数据库更新失败：{error}"))
    }
}
