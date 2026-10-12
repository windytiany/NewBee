use rusqlite::Connection;

mod migration;
pub(super) mod validation;

pub(super) fn definition() -> &'static str {
    include_str!("definition.sql")
}

const SCHEMA_VERSION: i64 = 7;

pub(super) fn initialize_schema(connection: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if matches!(version, 4..=6) {
        if matches!(version, 4 | 5) {
            migration::artwork::migrate(connection)?;
        }
        let transaction = connection.transaction()?;
        transaction
            .execute_batch("CREATE TABLE IF NOT EXISTS inbox (path TEXT PRIMARY KEY NOT NULL);")?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        return transaction.commit();
    }
    let has_tables: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')",
        [], |row| row.get(0),
    )?;
    if version != 0 || has_tables {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(definition())?;
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()
}

#[cfg(test)]
#[path = "../tests/schema.rs"]
mod tests;
