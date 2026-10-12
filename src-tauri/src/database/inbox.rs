use super::Database;

impl Database {
    pub(crate) fn inbox_paths(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT path FROM inbox ORDER BY rowid")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    }

    pub(crate) fn register_inbox_path(&self, path: &str) -> Result<bool, String> {
        self.connection()?
            .execute("INSERT OR IGNORE INTO inbox(path) VALUES (?1)", [path])
            .map(|count| count != 0)
            .map_err(|error| error.to_string())
    }

    pub(crate) fn remove_inbox_path(&self, path: &str) -> Result<(), String> {
        self.connection()?
            .execute("DELETE FROM inbox WHERE path = ?1", [path])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}
