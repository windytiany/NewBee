use rusqlite::Connection;
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use tauri::Manager;

pub(crate) mod artwork;
mod inbox;
mod library;
mod lyrics;
mod metadata;
pub(crate) mod model;
mod playlist;
mod schema;
mod skip;
pub(crate) mod snapshot;
mod statistics;
#[cfg(test)]
pub(crate) mod tests;
pub(crate) mod tracks;

pub(crate) async fn blocking<R, T, E>(
    app: tauri::AppHandle<R>,
    action: impl FnOnce(&Database) -> Result<T, E> + Send + 'static,
) -> Result<T, E>
where
    R: tauri::Runtime,
    T: Send + 'static,
    E: From<String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || action(&app.state::<Database>()))
        .await
        .map_err(|error| E::from(format!("Database task failed: {error}")))?
}

fn cache_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

pub struct Database {
    connection: Mutex<Connection>,
    pub(crate) artwork: crate::artwork::reading::State,
    skipped_tracks: Arc<RwLock<HashSet<i64>>>,
    #[cfg(test)]
    pub(crate) after_file_write: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let cache = crate::artwork::cache::Cache::temporary().map_err(cache_error)?;
        Self::open_cached(path, cache)
    }

    pub(crate) fn open_with_cache(
        path: impl AsRef<Path>,
        cache_directory: &Path,
    ) -> rusqlite::Result<Self> {
        let cache = crate::artwork::cache::Cache::open(cache_directory).map_err(cache_error)?;
        Self::open_cached(path, cache)
    }

    fn open_cached(
        path: impl AsRef<Path>,
        artwork_cache: crate::artwork::cache::Cache,
    ) -> rusqlite::Result<Self> {
        let mut connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        schema::initialize_schema(&mut connection)?;

        let skipped_tracks = {
            let mut statement = connection.prepare("SELECT track_id FROM skipped_tracks")?;
            let rows = statement.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<HashSet<_>>>()?
        };
        let database = Self {
            connection: Mutex::new(connection),
            artwork: crate::artwork::reading::State::new(artwork_cache),
            skipped_tracks: Arc::new(RwLock::new(skipped_tracks)),
            #[cfg(test)]
            after_file_write: Mutex::new(None),
        };
        database
            .clean_artwork_cache()
            .map_err(|error| cache_error(std::io::Error::other(error)))?;
        Ok(database)
    }

    // Tauri's mock runtime retains managed state after its window/app is dropped.
    // Explicitly close the file connection so restart tests exercise a cold database.
    #[cfg(test)]
    pub(crate) fn close_test_connection(&self) {
        let mut connection = self.connection().unwrap();
        let previous = std::mem::replace(&mut *connection, Connection::open_in_memory().unwrap());
        previous.close().unwrap();
    }

    pub(crate) fn connection(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Database connection is unavailable".to_owned())
    }
}
