use super::synchronization::attach_source;
use crate::artwork::{
    model::ArtworkContent,
    track::{Collection, Draft, DraftPicture, Image, Picture},
};
use crate::database::Database;
use rusqlite::{params, Transaction};
use std::collections::HashSet;

impl Database {
    pub(crate) fn describe_artwork_collections(
        &self,
        track_ids: &[i64],
    ) -> Result<Vec<crate::artwork::track::commands::Description>, String> {
        use crate::artwork::track::commands::{Description, PictureDescription};
        track_ids
            .iter()
            .map(|id| {
                let result = (|| {
                    let connection = self.connection()?;
                    require_track(&connection, *id)?;
                    let mut statement = connection.prepare(
                        "SELECT a.id, i.content_id, i.mime_type, length(i.image), a.picture_type,
                                s.source_kind, s.source_path, a.source_error, a.is_display
                         FROM track_artwork a JOIN artwork_images i ON i.id = a.image_id
                         JOIN track_artwork_sources s ON s.artwork_id = a.id
                         WHERE a.track_id = ?1 ORDER BY a.id",
                    ).map_err(|error| error.to_string())?;
                    let rows = statement
                        .query_map([id], |row| {
                            Ok((
                                PictureDescription {
                                    artwork_id: row.get(0)?,
                                    content_id: row.get(1)?,
                                    mime_type: row.get(2)?,
                                    byte_length: row.get(3)?,
                                    picture_type: row.get(4)?,
                                    source: row.get(5)?,
                                    path: row.get(6)?,
                                    error: row.get(7)?,
                                },
                                row.get::<_, bool>(8)?,
                            ))
                        })
                        .map_err(|error| error.to_string())?;
                    let mut description = Description {
                        track_id: *id,
                        pictures: Vec::new(),
                        display_index: None,
                        error: None,
                    };
                    for row in rows {
                        let (picture, selected) = row.map_err(|error| error.to_string())?;
                        if selected {
                            description.display_index = Some(description.pictures.len());
                        }
                        description.pictures.push(picture);
                    }
                    Ok::<_, String>(description)
                })();
                Ok(result.unwrap_or_else(|error| Description {
                    track_id: *id,
                    pictures: Vec::new(),
                    display_index: None,
                    error: Some(error),
                }))
            })
            .collect()
    }

    pub fn get_artwork_collection(&self, track_id: i64) -> Result<Collection, String> {
        let connection = self.connection()?;
        require_track(&connection, track_id)?;
        let mut statement = connection.prepare(
            "SELECT i.content_id, i.mime_type, i.image, a.picture_type, a.is_display, a.id, s.source_kind, s.source_path, a.source_error
             FROM track_artwork a JOIN artwork_images i ON i.id = a.image_id JOIN track_artwork_sources s ON s.artwork_id = a.id
             WHERE a.track_id = ?1 ORDER BY a.id",
        ).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([track_id], |row| {
                Ok((
                    Image {
                        artwork_id: row.get(5)?,
                        source: row.get(6)?,
                        path: row.get(7)?,
                        #[cfg(test)]
                        error: row.get(8)?,
                        picture: Picture {
                            content: ArtworkContent {
                                mime_type: row.get(1)?,
                                image: row.get(2)?,
                            },
                            picture_type: row.get(3)?,
                        },
                    },
                    row.get::<_, bool>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut collection = Collection::default();
        for row in rows {
            let (image, is_display) = row.map_err(|error| error.to_string())?;
            if is_display {
                collection.display_index = Some(collection.images.len());
            }
            collection.images.push(image);
        }
        Ok(collection)
    }

    pub fn save_artwork_drafts(&self, drafts: &[(i64, Draft)]) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let mut tracks = HashSet::new();
        for (track_id, draft) in drafts {
            if !tracks.insert(*track_id) {
                return Err("Duplicate artwork draft track".into());
            }
            require_track(&transaction, *track_id)?;
            save(&transaction, *track_id, draft)?;
            transaction
                .execute(
                    "DELETE FROM track_artwork_pending WHERE track_id = ?1",
                    [track_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }
}

fn require_track(connection: &rusqlite::Connection, track_id: i64) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)",
            [track_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err(format!("曲目 {track_id} 已不在数据库中"));
    }
    Ok(())
}

pub(in crate::database) fn save(
    transaction: &Transaction<'_>,
    track_id: i64,
    draft: &Draft,
) -> Result<(), String> {
    require_track(transaction, track_id)?;
    transaction
        .execute(
            "DELETE FROM track_artwork_pending WHERE track_id = ?1",
            [track_id],
        )
        .map_err(|error| error.to_string())?;
    if draft
        .display_index
        .is_some_and(|index| index >= draft.pictures.len())
    {
        return Err("Invalid artwork display selection".into());
    }
    let mut ids = Vec::new();
    for picture in &draft.pictures {
        let (id, picture_type) = match picture {
            DraftPicture::Existing {
                artwork_id,
                picture_type,
            } => {
                let id = transaction
                    .query_row(
                        "SELECT id FROM track_artwork WHERE track_id = ?1 AND id = ?2",
                        params![track_id, artwork_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(|error| format!("Artwork draft references missing item: {error}"))?;
                (id, *picture_type)
            }
            DraftPicture::New(picture) => {
                validate_content(&picture.content)?;
                let path: String = transaction
                    .query_row("SELECT path FROM tracks WHERE id = ?1", [track_id], |row| {
                        row.get(0)
                    })
                    .map_err(|error| error.to_string())?;
                (
                    attach_source(
                        transaction,
                        track_id,
                        &picture.content,
                        picture.picture_type,
                        "embedded",
                        &path,
                    )?,
                    picture.picture_type,
                )
            }
            DraftPicture::Linked { path, picture } => {
                validate_content(&picture.content)?;
                if !std::path::Path::new(path).is_absolute() {
                    return Err("Linked artwork path must be absolute".into());
                }
                (
                    attach_source(
                        transaction,
                        track_id,
                        &picture.content,
                        picture.picture_type,
                        "manual",
                        path,
                    )?,
                    picture.picture_type,
                )
            }
        };
        if ids.contains(&id) {
            return Err("Duplicate artwork item".into());
        }
        let current_type: u8 = transaction
            .query_row(
                "SELECT picture_type FROM track_artwork WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if current_type != picture_type {
            transaction
                .execute(
                    "UPDATE track_artwork SET picture_type = ?2 WHERE id = ?1",
                    params![id, picture_type],
                )
                .map_err(|error| error.to_string())?;
        }
        ids.push(id);
    }
    let previous_ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM track_artwork WHERE track_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([track_id], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    for id in previous_ids {
        if !ids.contains(&id) {
            transaction
                .execute("DELETE FROM track_artwork WHERE id = ?1", [id])
                .map_err(|error| error.to_string())?;
        }
    }
    transaction
        .execute(
            "UPDATE track_artwork SET is_display = 0 WHERE track_id = ?1",
            [track_id],
        )
        .map_err(|error| error.to_string())?;
    if let Some(id) = draft
        .display_index
        .or(if ids.is_empty() { None } else { Some(0) })
        .map(|index| ids[index])
    {
        transaction
            .execute(
                "UPDATE track_artwork SET is_display = 1 WHERE id = ?1",
                [id],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn validate_content(content: &ArtworkContent) -> Result<(), String> {
    if content.image.len() > crate::metadata::files::MAX_COVER_BYTES {
        return Err("Artwork exceeds size limit".into());
    }
    let format =
        image::guess_format(&content.image).map_err(|error| format!("Invalid artwork: {error}"))?;
    if format.to_mime_type() != content.mime_type {
        return Err("Artwork MIME type does not match content".into());
    }
    image::load_from_memory_with_format(&content.image, format)
        .map_err(|error| format!("Invalid artwork: {error}"))?;
    Ok(())
}

pub(in crate::database) fn add_cover(
    transaction: &Transaction<'_>,
    track_id: i64,
    cover: &ArtworkContent,
    audio_path: Option<&str>,
) -> Result<(), String> {
    let path = audio_path.unwrap_or("");
    let id = attach_source(transaction, track_id, cover, 3, "embedded", path)?;
    transaction
        .execute(
            "UPDATE track_artwork SET is_display = 0 WHERE track_id = ?1",
            [track_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE track_artwork SET is_display = 1 WHERE id = ?1",
            [id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
