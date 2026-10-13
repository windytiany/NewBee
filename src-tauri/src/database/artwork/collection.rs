use super::synchronization::{attach, select_display, source};
use crate::artwork::{
    collection::{Collection, Draft, DraftPicture, Image, Picture},
    model::ArtworkContent,
};
use crate::database::Database;
#[cfg(test)]
use rusqlite::OptionalExtension;
use rusqlite::{params, Transaction};
use std::collections::HashSet;

impl Database {
    pub(crate) fn describe_artwork_collections(
        &self,
        track_ids: &[i64],
    ) -> Result<Vec<crate::artwork::collection::commands::Description>, String> {
        use crate::artwork::collection::commands::{Description, PictureDescription};
        let connection = self.connection()?;
        let mut descriptions: Vec<_> = track_ids
            .iter()
            .map(|id| Description {
                track_id: *id,
                pictures: Vec::new(),
                display_index: None,
                error: Some(format!("曲目 {id} 已不在数据库中")),
            })
            .collect();
        let mut statement = connection.prepare(
            "SELECT t.id, i.content_id, i.mime_type, length(i.image), COALESCE(a.type_override, a.picture_type), a.is_display,
                    EXISTS (SELECT 1 FROM track_artwork_sources s WHERE s.artwork_id = a.id AND s.source_kind = 'embedded')
             FROM tracks t LEFT JOIN track_artwork a ON a.track_id = t.id LEFT JOIN artwork_images i ON i.id = a.image_id
             WHERE t.id IN (SELECT value FROM json_each(?1)) ORDER BY t.id, a.id"
        ).map_err(|error| error.to_string())?;
        let ids = serde_json::to_string(track_ids).map_err(|error| error.to_string())?;
        let mut rows = statement.query([ids]).map_err(|error| error.to_string())?;
        while let Some(row) = rows.next().map_err(|error| error.to_string())? {
            let id: i64 = row.get(0).map_err(|error| error.to_string())?;
            let description = descriptions
                .iter_mut()
                .find(|item| item.track_id == id)
                .ok_or_else(|| "Unexpected artwork track".to_owned())?;
            description.error = None;
            if let Some(content_id) = row
                .get::<_, Option<String>>(1)
                .map_err(|error| error.to_string())?
            {
                if row.get::<_, bool>(5).map_err(|error| error.to_string())? {
                    description.display_index = Some(description.pictures.len());
                }
                description.pictures.push(PictureDescription {
                    content_id,
                    mime_type: row.get(2).map_err(|error| error.to_string())?,
                    byte_length: row.get(3).map_err(|error| error.to_string())?,
                    picture_type: row.get(4).map_err(|error| error.to_string())?,
                    embedded: row.get(6).map_err(|error| error.to_string())?,
                });
            }
        }
        Ok(descriptions)
    }

    pub fn get_artwork_collection(&self, track_id: i64) -> Result<Collection, String> {
        let connection = self.connection()?;
        require_track(&connection, track_id)?;
        let mut statement = connection.prepare(
            "SELECT i.content_id, i.mime_type, i.image, COALESCE(a.type_override, a.picture_type), a.is_display
             FROM track_artwork a JOIN artwork_images i ON i.id = a.image_id
             WHERE a.track_id = ?1 ORDER BY a.id",
        ).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([track_id], |row| {
                Ok((
                    Image {
                        content_id: row.get(0)?,
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

    #[cfg(test)]
    pub(crate) fn sync_artwork_collection(
        &self,
        track_id: i64,
        path: &str,
        scan: &crate::artwork::collection::Scan,
    ) -> Result<(), String> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current_path: Option<String> = transaction
            .query_row("SELECT path FROM tracks WHERE id = ?1", [track_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        if current_path.as_deref() != Some(path) {
            return Err("Track artwork path changed or track was removed".into());
        }
        super::synchronization::sync(&transaction, track_id, path, scan)?;
        transaction
            .execute(
                "DELETE FROM track_artwork_pending WHERE track_id = ?1",
                [track_id],
            )
            .map_err(|error| error.to_string())?;
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
                content_id,
                picture_type,
            } => {
                let id = transaction.query_row(
                    "SELECT a.id FROM track_artwork a JOIN artwork_images i ON i.id = a.image_id
                     WHERE a.track_id = ?1 AND i.content_id = ?2",
                    params![track_id, content_id], |row| row.get::<_, i64>(0),
                ).map_err(|error| format!("Artwork draft references missing content: {error}"))?;
                (id, *picture_type)
            }
            DraftPicture::New(picture) => {
                validate_content(&picture.content)?;
                let id = attach(
                    transaction,
                    track_id,
                    &picture.content,
                    picture.picture_type,
                )?;
                source(transaction, id, "manual", "", picture.picture_type)?;
                (id, picture.picture_type)
            }
        };
        let current_type: u8 = transaction
            .query_row(
                "SELECT COALESCE(type_override, picture_type) FROM track_artwork WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if current_type != picture_type {
            transaction
                .execute(
                    "UPDATE track_artwork SET type_override = ?2 WHERE id = ?1",
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
    if let Some(index) = draft.display_index {
        transaction
            .execute(
                "UPDATE track_artwork SET is_display = 0 WHERE track_id = ?1",
                [track_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE track_artwork SET is_display = 1 WHERE id = ?1",
                [ids[index]],
            )
            .map_err(|error| error.to_string())?;
    }
    select_display(transaction, track_id)
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
    let id = attach(transaction, track_id, cover, 3)?;
    let (kind, path) = audio_path.map_or(("manual", ""), |path| ("embedded", path));
    source(transaction, id, kind, path, 3)?;
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

#[cfg(test)]
#[path = "tests/collection.rs"]
mod tests;
