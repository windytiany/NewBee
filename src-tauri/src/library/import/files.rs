use super::{has_supported_extension, import_track, record_failure, ImportResult};
use crate::data::write::WriteState;
use crate::database::Database;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub async fn import_music_files<R: tauri::Runtime>(
    paths: Vec<String>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<ImportResult, String> {
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::logging::with_operation(operation_id.clone(), || {
            let _guard = guard;
            log::info!("event=import_started operationId={operation_id:?}");
            use tauri::Manager;
            let database = app.state::<Database>();
            let result = run_import(&database, &paths);
            log::info!("event=import_completed operationId={operation_id:?}");
            result
        })
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
                record_failure(database, &mut result, path, "selected path is not a file");
                continue;
            }
            Err(error) => {
                record_failure(database, &mut result, path, &error.to_string());
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
