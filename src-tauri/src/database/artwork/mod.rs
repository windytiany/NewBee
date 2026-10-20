pub(super) mod collection;
mod linked;
pub(super) mod reading;
pub(crate) use linked::update_linked_snapshot;
pub(super) mod synchronization;

use crate::artwork::model::ArtworkContent;
use rusqlite::params;

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
#[path = "../tests/digest.rs"]
mod tests;
