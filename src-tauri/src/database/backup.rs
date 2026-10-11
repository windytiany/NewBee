use super::Database;
use rusqlite::{Connection, OpenFlags};
use std::path::Path;

impl Database {
    pub(crate) fn backup_snapshot(&self, destination: &Path) -> Result<(), String> {
        let destination = destination
            .to_str()
            .ok_or("备份路径不是有效的 UTF-8 路径")?;
        self.connection()?
            .execute("VACUUM INTO ?1", [destination])
            .map_err(|error| format!("无法备份数据库：{error}"))?;
        Ok(())
    }
}

mod schema;

pub(crate) fn validate_backup_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("无法打开备份：{error}"))?;
    let expected = Database::open(":memory:").map_err(|error| error.to_string())?;
    let expected = expected.connection()?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let expected_version: i64 = expected
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version != expected_version {
        return Err("备份数据库与当前版本不兼容".into());
    }
    schema::validate(&connection, &expected)?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err("备份数据库已损坏".into());
    }
    let mut foreign_keys = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| error.to_string())?;
    if foreign_keys.exists([]).map_err(|error| error.to_string())? {
        return Err("备份数据库关联数据已损坏".into());
    }
    drop(foreign_keys);
    Ok(connection)
}
