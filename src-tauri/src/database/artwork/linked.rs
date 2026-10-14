use crate::database::Database;
use rusqlite::params;

impl Database {
    pub(crate) fn refresh_artwork_paths(&self, track_id: Option<i64>) -> Result<(), String> {
        let paths = {
            let connection = self.connection()?;
            let mut statement = connection.prepare(
                "SELECT a.id, a.image_id, s.source_path FROM track_artwork a JOIN track_artwork_sources s ON s.artwork_id = a.id
                 WHERE s.source_kind != 'embedded' AND (?1 IS NULL OR a.track_id = ?1)"
            ).map_err(|error| error.to_string())?;
            let rows = statement
                .query_map([track_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|error| error.to_string())?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| error.to_string())?
        };
        for (id, previous_image, path) in paths {
            let content = crate::artwork::collection::linked::read(&path);
            let mut connection = self.connection()?;
            let transaction = connection
                .transaction()
                .map_err(|error| error.to_string())?;
            let current: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM track_artwork a JOIN track_artwork_sources s ON s.artwork_id = a.id
                 WHERE a.id = ?1 AND a.image_id = ?2 AND s.source_path = ?3 AND s.source_kind != 'embedded')",
                params![id, previous_image, path], |row| row.get(0),
            ).map_err(|error| error.to_string())?;
            if !current {
                continue;
            }
            match content {
                Ok(content) => {
                    let image_id = super::persist_image(&transaction, &content)?;
                    transaction.execute("UPDATE track_artwork SET image_id = ?2, source_error = NULL WHERE id = ?1", params![id, image_id])
                        .map_err(|error| error.to_string())?;
                }
                Err(error) => {
                    transaction
                        .execute(
                            "UPDATE track_artwork SET source_error = ?2 WHERE id = ?1",
                            params![id, error],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            transaction.commit().map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}
