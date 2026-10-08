use super::ArtworkContent;
use rusqlite::{params, Transaction};

/// Controls whether a confirmed read replaces artwork or retains a failed source's snapshot.
pub(crate) enum ArtworkUpdate {
    Embedded,
    Directory(String),
    Preserve,
    PreserveDirectory,
}

pub(super) fn persist_artwork(
    transaction: &Transaction<'_>,
    track_id: i64,
    artwork: Option<&ArtworkContent>,
    update: &ArtworkUpdate,
    audio_path: &str,
) -> Result<(), String> {
    if matches!(update, ArtworkUpdate::Preserve) {
        return Ok(());
    }
    let Some(artwork) = artwork else {
        let sql = if matches!(update, ArtworkUpdate::PreserveDirectory) {
            "DELETE FROM track_artwork WHERE track_id = ?1 AND source_kind != 'directory'"
        } else {
            "DELETE FROM track_artwork WHERE track_id = ?1"
        };
        transaction
            .execute(sql, [track_id])
            .map_err(|error| error.to_string())?;
        return Ok(());
    };
    // Exact byte equality is the content identity. IDs are never reused, including after removal.
    transaction.execute(
        "INSERT INTO artwork_images (mime_type, image) VALUES (?1, ?2) ON CONFLICT(image) DO NOTHING",
        params![artwork.mime_type, artwork.image],
    ).map_err(|error| error.to_string())?;
    let image_id: i64 = transaction
        .query_row(
            "SELECT id FROM artwork_images WHERE image = ?1",
            [&artwork.image],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let (kind, path) = match update {
        ArtworkUpdate::Directory(path) => ("directory", path.as_str()),
        _ => ("embedded", audio_path),
    };
    transaction.execute(
        "INSERT INTO track_artwork (track_id, image_id, source_kind, source_path) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(track_id) DO UPDATE SET image_id = excluded.image_id, source_kind = excluded.source_kind, source_path = excluded.source_path",
        params![track_id, image_id, kind, path],
    ).map_err(|error| error.to_string())?;
    Ok(())
}
