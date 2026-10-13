mod confirmation;

use crate::artwork::model::ArtworkContent;
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
    let image_id = persist_image(transaction, artwork)?;
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

pub(super) fn persist_image(
    connection: &rusqlite::Connection,
    artwork: &ArtworkContent,
) -> Result<i64, String> {
    use sha2::{Digest, Sha256};
    persist_digest(connection, artwork, &Sha256::digest(&artwork.image))
}

fn persist_digest(
    connection: &rusqlite::Connection,
    artwork: &ArtworkContent,
    digest: &[u8],
) -> Result<i64, String> {
    let mut statement = connection
        .prepare("SELECT id, image FROM artwork_images WHERE digest = ?1")
        .map_err(|error| error.to_string())?;
    let mut candidates = statement
        .query([digest])
        .map_err(|error| error.to_string())?;
    while let Some(row) = candidates.next().map_err(|error| error.to_string())? {
        let bytes = row.get_ref(1).map_err(|error| error.to_string())?;
        if bytes.as_blob().map_err(|error| error.to_string())? == artwork.image {
            return row.get(0).map_err(|error| error.to_string());
        }
    }
    connection
        .execute(
            "INSERT INTO artwork_images (mime_type, digest, image) VALUES (?1, ?2, ?3)",
            params![artwork.mime_type, digest, artwork.image],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection.last_insert_rowid())
}

#[cfg(test)]
#[path = "tests/digest.rs"]
mod tests;
