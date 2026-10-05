use super::{has_supported_extension, import_track, record_failure, ImportResult};
use crate::database::{write::WriteState, Database};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub async fn import_music_files(
    paths: Vec<String>,
    app: tauri::AppHandle,
    write: State<'_, WriteState>,
) -> Result<ImportResult, String> {
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        use tauri::Manager;
        let database = app.state::<Database>();
        run_import(&database, &paths)
    })
    .await
    .map_err(|error| format!("Music file import task failed: {error}"))
}

pub(super) fn run_import(database: &Database, paths: &[String]) -> ImportResult {
    let mut result = ImportResult::default();
    let mut visited = HashSet::new();
    for path in paths {
        let path = Path::new(path);
        if !has_supported_extension(path) {
            result.skipped += 1;
            continue;
        }
        let canonical = match fs::canonicalize(path) {
            Ok(canonical) if canonical.is_file() => canonical,
            Ok(_) => {
                record_failure(&mut result, path, "selected path is not a file");
                continue;
            }
            Err(error) => {
                record_failure(&mut result, path, &error.to_string());
                continue;
            }
        };
        if !visited.insert(canonical.clone()) {
            result.skipped += 1;
            continue;
        }
        import_track(database, &canonical, &mut result);
    }
    result
}
