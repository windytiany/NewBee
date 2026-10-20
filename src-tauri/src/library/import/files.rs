use super::import_track;
use crate::database::Database;
use crate::library::model::ImportResult;
use crate::locking::WriteState;
use crate::tracks::has_supported_extension;
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
) -> Result<ImportResult, super::error::CommandError> {
    use super::error::CommandError;
    let guard = write.acquire().map_err(CommandError::busy)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::logging::with_operation(operation_id.clone(), || {
            let _guard = guard;
            log::debug!("event=import_started");
            use tauri::Manager;
            let database = app.state::<Database>();
            let result = run_import(&database, &paths);
            log::debug!(
                "event=import_finished failed={} added={} updated={}",
                result.failed,
                result.added,
                result.updated
            );
            result
        })
    })
    .await
    .map_err(|error| CommandError::import(format!("Music file import task failed: {error}")))
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
                result.record_failure(path, "discovery", "selected path is not a file");
                continue;
            }
            Err(error) => {
                result.record_failure(path, "discovery", &error.to_string());
                continue;
            }
        };
        if !visited.insert(canonical.clone()) {
            result.skipped += 1;
            continue;
        }
        import_track(database, &canonical, &mut result);
    }
    result.flush_failures();
    result
}
