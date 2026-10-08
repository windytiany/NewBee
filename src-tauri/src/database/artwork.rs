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

impl super::Database {
    pub(crate) fn track_artwork_bytes(
        &self,
        track_id: i64,
        size: Option<u32>,
        derive: impl FnOnce(Vec<u8>, u32) -> Result<Vec<u8>, String>,
    ) -> Result<Vec<u8>, String> {
        use rusqlite::OptionalExtension;
        self.artwork_bytes(size, derive, |connection| {
            connection
                .query_row(
                    "SELECT image_id FROM track_artwork WHERE track_id = ?1",
                    [track_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| error.to_string())
        })
    }

    pub(crate) fn album_artwork_bytes(
        &self,
        album_artist: Option<String>,
        album: Option<String>,
        size: Option<u32>,
        derive: impl FnOnce(Vec<u8>, u32) -> Result<Vec<u8>, String>,
    ) -> Result<Vec<u8>, String> {
        use rusqlite::OptionalExtension;
        self.artwork_bytes(size, derive, |connection| {
            connection
                .query_row(
                    "SELECT ta.image_id FROM tracks t
             INNER JOIN track_artwork ta ON ta.track_id = t.id
             WHERE t.album_artist IS ?1 AND t.album IS ?2
             ORDER BY t.disc_number IS NULL, t.disc_number,
                      t.track_number IS NULL, t.track_number, t.id LIMIT 1",
                    params![album_artist, album],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|error| error.to_string())
        })
    }

    fn artwork_bytes(
        &self,
        size: Option<u32>,
        derive: impl FnOnce(Vec<u8>, u32) -> Result<Vec<u8>, String>,
        select_image: impl Fn(&rusqlite::Connection) -> Result<Option<i64>, String>,
    ) -> Result<Vec<u8>, String> {
        use rusqlite::OptionalExtension;
        let mut derivation = None;
        let (image_id, original, size) = loop {
            let connection = self.connection()?;
            let Some(image_id) = select_image(&connection)? else {
                return Ok(Vec::new());
            };
            if let Some(size) = size {
                if let Some(bytes) = connection
                    .query_row(
                        "SELECT image FROM artwork_thumbnails WHERE image_id = ?1 AND size = ?2",
                        params![image_id, size],
                        |row| row.get::<_, Vec<u8>>(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?
                {
                    return Ok(bytes);
                }
                if derivation.is_none() {
                    // Only cold requests wait. Never wait while holding the DB
                    // lock; recheck selection and cache after acquiring the gate.
                    drop(connection);
                    derivation = Some(
                        self.artwork_derivation
                            .lock()
                            .map_err(|_| "Artwork derivation is unavailable".to_owned())?,
                    );
                    continue;
                }
            }
            let original = connection
                .query_row(
                    "SELECT image FROM artwork_images WHERE id = ?1",
                    [image_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            let Some(size) = size else {
                return Ok(original);
            };
            break (image_id, original, size);
        };
        let derived = derive(original, size);
        let connection = self.connection()?;
        // Selection may have changed while deriving, including an album's chosen
        // track. Revalidate and publish atomically; never return obsolete artwork.
        match select_image(&connection)? {
            None => return Ok(Vec::new()),
            Some(current) if current != image_id => {
                return Err(
                    "Artwork changed during thumbnail derivation; retry the request".into(),
                );
            }
            Some(_) => {}
        }
        let bytes = derived?;
        connection
            .execute(
                "INSERT INTO artwork_thumbnails (image_id, size, image) VALUES (?1, ?2, ?3)",
                params![image_id, size, bytes],
            )
            .map_err(|error| error.to_string())?;
        Ok(bytes)
    }
}
