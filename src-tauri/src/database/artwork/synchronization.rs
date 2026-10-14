use crate::artwork::collection::Scan;
use rusqlite::{params, OptionalExtension, Transaction};
use std::collections::HashSet;

pub(in crate::database) fn sync(
    transaction: &Transaction<'_>,
    track_id: i64,
    audio_path: &str,
    scan: &Scan,
) -> Result<(), String> {
    let mut retained = HashSet::new();
    if let Ok(pictures) = &scan.embedded {
        for picture in pictures {
            let id = attach_source(
                transaction,
                track_id,
                &picture.content,
                picture.picture_type,
                "embedded",
                audio_path,
            )?;
            retained.insert(id);
        }
    }
    if let Ok(pictures) = &scan.directory {
        for picture in pictures {
            if let Ok(content) = &picture.content {
                let id = attach_source(
                    transaction,
                    track_id,
                    content,
                    3,
                    "directory",
                    &picture.path,
                )?;
                retained.insert(id);
            }
        }
    }
    let previous = {
        let mut statement = transaction.prepare(
            "SELECT a.id, s.source_kind FROM track_artwork a JOIN track_artwork_sources s ON s.artwork_id = a.id WHERE a.track_id = ?1"
        ).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([track_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    for (id, kind) in previous {
        // Complete scans remove absent scanned sources, but preserve manual associations.
        if kind != "manual"
            && scan.embedded.is_ok()
            && scan.directory.is_ok()
            && !retained.contains(&id)
        {
            transaction
                .execute("DELETE FROM track_artwork WHERE id = ?1", [id])
                .map_err(|error| error.to_string())?;
        }
    }
    select_display(transaction, track_id)
}

pub(super) fn attach_source(
    transaction: &Transaction<'_>,
    track_id: i64,
    content: &crate::artwork::model::ArtworkContent,
    picture_type: u8,
    kind: &str,
    path: &str,
) -> Result<i64, String> {
    let normalized;
    let path = if kind != "embedded" {
        normalized =
            crate::artwork::collection::linked::normalize(path).unwrap_or_else(|_| path.to_owned());
        normalized.as_str()
    } else {
        path
    };
    let image_id = super::persist_image(transaction, content)?;
    let existing: Option<i64> = if kind == "embedded" {
        transaction.query_row(
            "SELECT a.id FROM track_artwork a JOIN track_artwork_sources s ON s.artwork_id = a.id
             WHERE a.track_id = ?1 AND a.image_id = ?2 AND a.picture_type = ?3 AND s.source_kind = 'embedded'",
            params![track_id, image_id, picture_type], |row| row.get(0),
        ).optional()
    } else {
        transaction.query_row(
            "SELECT a.id FROM track_artwork a JOIN track_artwork_sources s ON s.artwork_id = a.id
             WHERE a.track_id = ?1 AND s.source_kind != 'embedded' AND s.source_path = ?2",
            params![track_id, path], |row| row.get(0),
        ).optional()
    }.map_err(|error| error.to_string())?;
    if let Some(id) = existing {
        transaction
            .execute(
                "UPDATE track_artwork SET image_id = ?2, source_error = NULL WHERE id = ?1",
                params![id, image_id],
            )
            .map_err(|error| error.to_string())?;
        return Ok(id);
    }
    transaction
        .execute(
            "INSERT INTO track_artwork (track_id, image_id, picture_type) VALUES (?1, ?2, ?3)",
            params![track_id, image_id, picture_type],
        )
        .map_err(|error| error.to_string())?;
    let id = transaction.last_insert_rowid();
    source(transaction, id, kind, path, picture_type)?;
    Ok(id)
}

pub(super) fn source(
    transaction: &Transaction<'_>,
    artwork_id: i64,
    kind: &str,
    path: &str,
    picture_type: u8,
) -> Result<(), String> {
    transaction.execute(
        "INSERT INTO track_artwork_sources (artwork_id, source_kind, source_path, picture_type)
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT(artwork_id) DO UPDATE SET source_kind = excluded.source_kind,
         source_path = excluded.source_path, picture_type = excluded.picture_type",
        params![artwork_id, kind, path, picture_type],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub(in crate::database) fn select_display(
    transaction: &Transaction<'_>,
    track_id: i64,
) -> Result<(), String> {
    transaction.execute(
        "UPDATE track_artwork SET is_display = 1 WHERE id = (
            SELECT id FROM track_artwork WHERE track_id = ?1
            ORDER BY picture_type != 3,
                NOT EXISTS (SELECT 1 FROM track_artwork_sources s WHERE s.artwork_id = track_artwork.id AND s.source_kind = 'embedded'), id LIMIT 1
         ) AND NOT EXISTS (SELECT 1 FROM track_artwork WHERE track_id = ?1 AND is_display = 1)", [track_id],
    ).map_err(|error| error.to_string())?;
    Ok(())
}
