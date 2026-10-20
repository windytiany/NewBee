use super::{
    files,
    model::{LyricsMarkAction, MetadataChange, MetadataField},
    MetadataSaveResult,
};
use crate::artwork::model::ArtworkContent;
use crate::database::Database;
use lofty::picture::Picture;
use std::path::Path;

pub(crate) struct CoverUpdate {
    pub(crate) picture: Option<Picture>,
    artwork: Option<ArtworkContent>,
}

impl CoverUpdate {
    pub(crate) fn new(picture: Picture) -> Self {
        let artwork = ArtworkContent {
            mime_type: picture
                .mime_type()
                .map(ToString::to_string)
                .unwrap_or_default(),
            image: picture.data().to_vec(),
        };
        Self {
            picture: Some(picture),
            artwork: Some(artwork),
        }
    }
    #[cfg(test)]
    pub(crate) fn delete() -> Self {
        Self {
            picture: None,
            artwork: None,
        }
    }
}

/// Callers normalize and validate their batch and hold the write guard.
/// A successful file operation need not change bytes. Database failure does not roll it back.
pub(crate) fn save_track(
    database: &Database,
    track_id: i64,
    changes: &[MetadataChange],
    action: LyricsMarkAction,
    cover: Option<&CoverUpdate>,
) -> MetadataSaveResult {
    persist_track(database, track_id, changes, action, cover, None)
}

pub(crate) fn save_track_collection(
    database: &Database,
    track_id: i64,
    changes: &[MetadataChange],
    action: LyricsMarkAction,
    artwork: Option<&crate::artwork::collection::editing::Prepared>,
) -> MetadataSaveResult {
    persist_track(database, track_id, changes, action, None, artwork)
}

fn persist_track(
    database: &Database,
    track_id: i64,
    changes: &[MetadataChange],
    action: LyricsMarkAction,
    cover: Option<&CoverUpdate>,
    artwork: Option<&crate::artwork::collection::editing::Prepared>,
) -> MetadataSaveResult {
    let mut result = MetadataSaveResult {
        track_id,
        path: String::new(),
        file_written: false,
        database_updated: false,
        error: None,
    };
    let outcome = (|| {
        let track = database
            .get_track(track_id)?
            .ok_or_else(|| format!("曲目 {track_id} 已不在数据库中"))?;
        result.path = track.path().to_owned();
        let mut effective_changes = changes.to_vec();
        if action == LyricsMarkAction::Mark {
            effective_changes.retain(|change| change.field != MetadataField::Lyrics);
            effective_changes.push(MetadataChange {
                values: Vec::new(),
                field: MetadataField::Lyrics,
                value: None,
            });
        }
        let write_artwork = artwork
            .map(|artwork| artwork.requires_file_write(Path::new(track.path())))
            .transpose()?
            .unwrap_or(false);
        if !effective_changes.is_empty() || cover.is_some() || write_artwork {
            database.begin_track_inspection(track_id)?;
            let path = Path::new(track.path());
            if let Some(cover) = cover {
                files::write_file_with_cover(
                    path,
                    &effective_changes,
                    Some(match cover.picture.as_ref() {
                        Some(picture) => files::CoverAction::Replace(picture),
                        None => files::CoverAction::Delete,
                    }),
                )?;
            } else if write_artwork {
                files::write_file_with_pictures(
                    path,
                    &effective_changes,
                    artwork.map(|artwork| artwork.pictures.as_slice()),
                )?;
            } else {
                files::write_file(path, &effective_changes)?;
            }
            result.file_written = true;
            #[cfg(test)]
            if let Some(hook) = database.after_file_write.lock().unwrap().take() {
                hook();
            }
        }
        let synchronize = (|| {
            if !result.file_written
                && !artwork.is_some_and(|artwork| artwork.embedded_changed)
                && effective_changes.is_empty()
                && action == LyricsMarkAction::Keep
            {
                if let Some(artwork) = artwork {
                    return database.save_artwork_drafts(&[(track_id, artwork.draft.clone())]);
                }
            }
            let confirmed =
                if result.file_written || artwork.is_some_and(|artwork| artwork.embedded_changed) {
                    Some(
                        files::read_track_metadata(Path::new(track.path()))?
                            .ok_or_else(|| "写后文件格式不支持快照".to_owned())?,
                    )
                } else {
                    None
                };
            database.update_metadata_cover_and_lyrics(
                track_id,
                &effective_changes,
                cover.map(|cover| cover.artwork.as_ref()),
                artwork.map(|artwork| &artwork.draft),
                action,
                confirmed.as_ref(),
            )
        })();
        synchronize.map_err(|error| {
            if result.file_written {
                format!("文件已写入，但数据库同步失败。请再次保存或重新扫描：{error}")
            } else {
                format!("数据库更新失败：{error}")
            }
        })?;
        result.database_updated = true;
        Ok::<_, String>(())
    })();
    result.error = outcome.err();
    if result.database_updated {
        log::debug!(
            "event=metadata_saved trackId={track_id} path={:?} fileWritten={} databaseUpdated=true",
            result.path,
            result.file_written
        );
    } else {
        log::debug!("event=metadata_save_failed trackId={track_id} path={:?} fileWritten={} databaseUpdated=false error={:?}", result.path, result.file_written, result.error);
    }
    result
}
