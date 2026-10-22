use std::{collections::HashSet, path::Path};

#[derive(Debug, serde::Serialize)]
pub(crate) struct Directory {
    path: String,
    name: String,
}

fn directories(paths: Vec<String>) -> Result<Vec<Directory>, String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for input in paths {
        if crate::tasks::cancelled() {
            break;
        }
        let path = Path::new(&input);
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Cannot access '{input}': {error}"))?;
        if !canonical.is_dir() || !seen.insert(canonical.clone()) {
            continue;
        }
        let name = path
            .file_name()
            .or_else(|| canonical.file_name())
            .ok_or_else(|| format!("Directory has no playlist name: {input}"))?
            .to_string_lossy()
            .into_owned();
        result.push(Directory {
            path: canonical.to_string_lossy().into_owned(),
            name,
        });
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn playlist_directories(
    paths: Vec<String>,
    operation_id: Option<String>,
) -> Result<Vec<Directory>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::tasks::with_operation(operation_id, || directories(paths))
    })
    .await
    .map_err(|error| format!("Playlist directory discovery task failed: {error}"))?
}
