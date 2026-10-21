use super::configuration::{Folder, Mode};
use crate::{database::Database, settings::SettingsState};

// Historical schema, used only when reading pre-unification databases and backups.
pub(crate) const DIRECTORIES: &str = "CREATE TABLE IF NOT EXISTS music_library_directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE
);";

pub(crate) fn run(database: &Database, settings: &SettingsState) -> Result<(), String> {
    let mut connection = database.connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'music_library_directories')",
        [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if !exists {
        return Ok(());
    }
    let paths = {
        let mut statement = transaction
            .prepare("SELECT path FROM music_library_directories ORDER BY id")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    settings.update_folders(|folders| {
        for path in paths {
            if let Some(folder) = folders.iter_mut().find(|folder| folder.path == path) {
                if !folder.enabled {
                    folder.mode = Mode::Manual;
                    folder.enabled = true;
                }
            } else {
                folders.push(Folder {
                    path,
                    mode: Mode::Manual,
                    enabled: true,
                });
            }
        }
        Ok(())
    })?;
    // Persist configuration before retiring the table. Retrying after a crash is idempotent.
    transaction
        .execute_batch("DROP TABLE music_library_directories;")
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}
