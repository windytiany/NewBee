use crate::artwork::collection::Scan;
use rusqlite::{params, Transaction};
use std::collections::HashSet;

pub(in crate::database) fn sync(
    transaction: &Transaction<'_>,
    track_id: i64,
    audio_path: &str,
    scan: &Scan,
) -> Result<(), String> {
    let mut retained = HashSet::new();
    if let Ok(pictures) = &scan.embedded {
        // Front cover wins when the same bytes occur with multiple embedded types.
        let mut pictures: Vec<_> = pictures.iter().collect();
        pictures.sort_by_key(|picture| picture.picture_type != 3);
        for picture in pictures {
            let id = attach(
                transaction,
                track_id,
                &picture.content,
                picture.picture_type,
            )?;
            if retained.insert((id, "embedded", audio_path)) {
                source(
                    transaction,
                    id,
                    "embedded",
                    audio_path,
                    picture.picture_type,
                )?;
            }
        }
    }
    if let Ok(pictures) = &scan.directory {
        for picture in pictures {
            if let Ok(content) = &picture.content {
                let id = attach(transaction, track_id, content, 3)?;
                source(transaction, id, "directory", &picture.path, 3)?;
                retained.insert((id, "directory", picture.path.as_str()));
            }
        }
    }
    let sources = {
        let mut statement = transaction.prepare(
            "SELECT s.id, s.artwork_id, s.source_kind, s.source_path FROM track_artwork_sources s
             JOIN track_artwork a ON a.id = s.artwork_id WHERE a.track_id = ?1",
        ).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([track_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    for (source_id, artwork_id, kind, path) in sources {
        if retained.contains(&(artwork_id, kind.as_str(), path.as_str())) {
            continue;
        }
        let confirmed_absent = match kind.as_str() {
            "embedded" => scan.embedded.is_ok(),
            "directory" => match &scan.directory {
                Ok(pictures) => !pictures
                    .iter()
                    .any(|picture| picture.path == path && picture.content.is_err()),
                Err(_) => false,
            },
            _ => false,
        };
        if confirmed_absent {
            transaction
                .execute(
                    "DELETE FROM track_artwork_sources WHERE id = ?1",
                    [source_id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction
        .execute(
            "DELETE FROM track_artwork WHERE track_id = ?1
         AND NOT EXISTS (SELECT 1 FROM track_artwork_sources WHERE artwork_id = track_artwork.id)",
            [track_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE track_artwork SET picture_type = (
            SELECT picture_type FROM track_artwork_sources WHERE artwork_id = track_artwork.id
            ORDER BY picture_type != 3, source_kind != 'embedded', id LIMIT 1
         ) WHERE track_id = ?1",
            [track_id],
        )
        .map_err(|error| error.to_string())?;
    select_display(transaction, track_id)
}

pub(super) fn attach(
    transaction: &Transaction<'_>,
    track_id: i64,
    content: &crate::artwork::model::ArtworkContent,
    picture_type: u8,
) -> Result<i64, String> {
    let image_id = super::persist_image(transaction, content)?;
    transaction
        .execute(
            "INSERT INTO track_artwork (track_id, image_id, picture_type) VALUES (?1, ?2, ?3)
         ON CONFLICT(track_id, image_id) DO NOTHING",
            params![track_id, image_id, picture_type],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .query_row(
            "SELECT id FROM track_artwork WHERE track_id = ?1 AND image_id = ?2",
            params![track_id, image_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

pub(super) fn source(
    transaction: &Transaction<'_>,
    artwork_id: i64,
    kind: &str,
    path: &str,
    picture_type: u8,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO track_artwork_sources (artwork_id, source_kind, source_path, picture_type)
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT(artwork_id, source_kind, source_path)
         DO UPDATE SET picture_type = excluded.picture_type",
            params![artwork_id, kind, path, picture_type],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(in crate::database) fn select_display(
    transaction: &Transaction<'_>,
    track_id: i64,
) -> Result<(), String> {
    transaction.execute(
        "UPDATE track_artwork SET is_display = 1 WHERE id = (
            SELECT id FROM track_artwork WHERE track_id = ?1
            ORDER BY COALESCE(type_override, picture_type) != 3,
                NOT EXISTS (SELECT 1 FROM track_artwork_sources s WHERE s.artwork_id = track_artwork.id AND s.source_kind = 'embedded'), id
            LIMIT 1
         ) AND NOT EXISTS (SELECT 1 FROM track_artwork WHERE track_id = ?1 AND is_display = 1)",
        [track_id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}
