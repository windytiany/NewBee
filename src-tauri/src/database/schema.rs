use rusqlite::Connection;

const SCHEMA_VERSION: i64 = 4;

pub(super) fn initialize_schema(connection: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    let has_tables: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')",
        [], |row| row.get(0),
    )?;
    if version != 0 || has_tables {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(&super::schema_sql())?;
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()
}

#[cfg(test)]
#[path = "tests/schema.rs"]
mod tests;
