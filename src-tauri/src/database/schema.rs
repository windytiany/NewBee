use rusqlite::Connection;

const SCHEMA_VERSION: i64 = 1;

pub(super) fn initialize_schema(connection: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        let transaction = connection.transaction()?;
        let has_tracks: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tracks')",
            [],
            |row| row.get(0),
        )?;
        if has_tracks {
            transaction.execute_batch(
                "ALTER TABLE tracks ADD COLUMN track_total INTEGER;
                 ALTER TABLE tracks ADD COLUMN disc_total INTEGER;",
            )?;
        }
        transaction.execute_batch(super::SCHEMA)?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()?;
        return Ok(());
    }
    connection.execute_batch(super::SCHEMA)
}

#[cfg(test)]
#[path = "tests/schema.rs"]
mod tests;
