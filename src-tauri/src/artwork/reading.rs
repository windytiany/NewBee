use super::cache::Cache;
use crate::database::Database;
use rusqlite::params;
use std::sync::Mutex;

pub(crate) struct State {
    cache: Cache,
    derivation: Mutex<()>,
    extraction: Mutex<()>,
    #[cfg(test)]
    decodes: std::sync::atomic::AtomicUsize,
}

impl State {
    pub(crate) fn new(cache: Cache) -> Self {
        Self {
            cache,
            derivation: Mutex::new(()),
            extraction: Mutex::new(()),
            #[cfg(test)]
            decodes: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl Database {
    pub(crate) fn complete_track_artwork(
        &self,
        track_id: i64,
        write: &crate::locking::write::WriteState,
    ) -> Result<(), String> {
        use rusqlite::OptionalExtension;
        let _extraction = self
            .artwork
            .extraction
            .lock()
            .map_err(|_| "Artwork extraction is unavailable".to_owned())?;
        let path: Option<String> = self.connection()?.query_row(
            "SELECT path FROM tracks JOIN track_artwork_pending ON track_id = tracks.id WHERE tracks.id = ?1",
            [track_id], |row| row.get(0),
        ).optional().map_err(|error| error.to_string())?;
        let Some(path) = path else {
            return Ok(());
        };
        let _guard = write.acquire()?;
        let audio = std::path::Path::new(&path);
        let outcome = (|| {
            let embedded = crate::metadata::files::artwork::read_embedded_cover(audio)?;
            if let Some(cover) = embedded {
                return Ok((Some(cover), crate::database::ArtworkUpdate::Embedded));
            }
            match crate::metadata::files::artwork::read_directory_cover(audio)? {
                Some((cover, source)) => Ok((
                    Some(cover),
                    crate::database::ArtworkUpdate::Directory(
                        source.to_string_lossy().into_owned(),
                    ),
                )),
                None => Ok((None, crate::database::ArtworkUpdate::Embedded)),
            }
        })();
        match outcome {
            Ok((content, source)) => {
                self.confirm_track_artwork(track_id, &path, content.as_ref(), &source)
            }
            Err(error) => {
                // A failed initial lookup is also terminal. Explicit reread/import
                // can accept later file changes; browsing must not repeatedly probe.
                self.confirm_track_artwork(
                    track_id,
                    &path,
                    None,
                    &crate::database::ArtworkUpdate::Embedded,
                )?;
                Err(error)
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn artwork_decode_count(&self) -> usize {
        self.artwork
            .decodes
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    #[cfg(test)]
    pub(crate) fn observe_artwork_decode(&self) {
        self.artwork
            .decodes
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

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
             WHERE t.in_library = 1 AND t.album_artist IS ?1 AND t.album IS ?2
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
        super::request::validate_size(size)?;
        let mut derivation = None;
        let (image_id, content, original, size) = loop {
            let connection = self.connection()?;
            let Some(image_id) = select_image(&connection)? else {
                return Ok(Vec::new());
            };
            let Some(size) = size else {
                return connection
                    .query_row(
                        "SELECT image FROM artwork_images WHERE id = ?1",
                        [image_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string());
            };
            let content: String = connection.query_row(
                "SELECT lower(hex(digest)) || '-' || content_id FROM artwork_images WHERE id = ?1",
                [image_id], |row| row.get(0),
            ).map_err(|error| error.to_string())?;
            if let Some(bytes) = self.artwork.cache.read(&content, size)? {
                return Ok(bytes);
            }
            if derivation.is_none() {
                // Cold requests share a bounded decode gate. Warm/original requests
                // bypass it, and the database is never locked while waiting.
                drop(connection);
                derivation = Some(
                    self.artwork
                        .derivation
                        .lock()
                        .map_err(|_| "Artwork derivation is unavailable".to_owned())?,
                );
                continue;
            }
            let original = connection
                .query_row(
                    "SELECT image FROM artwork_images WHERE id = ?1",
                    [image_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            break (image_id, content, original, size);
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
        self.artwork.cache.write(&content, size, &bytes)?;
        drop(connection);
        self.clean_artwork_cache()?;
        Ok(bytes)
    }

    pub(crate) fn clean_artwork_cache(&self) -> Result<(), String> {
        // Hold the DB lock until cleanup completes so a live identity cannot be
        // published between taking the snapshot and deleting orphaned files.
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT lower(hex(digest)) || '-' || content_id FROM artwork_images")
            .map_err(|error| error.to_string())?;
        let live = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<std::collections::HashSet<_>>>()
            .map_err(|error| error.to_string())?;
        self.artwork.cache.clean(&live)
    }
}
