use crate::database::Database;
use rusqlite::params;

impl Database {
    pub(crate) fn linked_artwork_sources(&self, path: &str) -> Result<Vec<(i64, String)>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT a.id, s.source_path FROM track_artwork a JOIN track_artwork_sources s ON s.artwork_id = a.id JOIN tracks t ON t.id = a.track_id WHERE t.path = ?1 AND s.source_kind = 'manual'",
        ).map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([path], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }
}

pub(crate) fn update_linked_snapshot(
    transaction: &rusqlite::Transaction<'_>,
    track_id: i64,
    artwork_id: i64,
    content: &crate::artwork::model::ArtworkContent,
) -> Result<(), String> {
    let image_id = super::persist_image(transaction, content)?;
    transaction.execute("UPDATE track_artwork SET image_id = ?3, source_error = NULL WHERE id = ?1 AND track_id = ?2", params![artwork_id, track_id, image_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}
