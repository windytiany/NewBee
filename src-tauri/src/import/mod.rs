fn readable_files(paths: Vec<String>) -> Vec<String> {
    crate::tracks::discovery::discover(&paths)
        .into_iter()
        .filter_map(Result::ok)
        .collect()
}

#[tauri::command]
pub(crate) async fn readable_audio_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || readable_files(paths))
        .await
        .map_err(|error| format!("Audio file discovery task failed: {error}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DropPreview {
    has_files: bool,
    has_directories: bool,
}

fn preview_paths(paths: Vec<String>) -> DropPreview {
    let mut preview = DropPreview {
        has_files: false,
        has_directories: false,
    };
    for input in paths {
        let path = std::path::Path::new(&input);
        if path.is_dir() {
            preview.has_directories |= std::fs::read_dir(path).is_ok();
        } else if crate::tracks::discovery::has_supported_extension(path) {
            preview.has_files |= std::fs::File::open(path)
                .and_then(|file| file.metadata())
                .is_ok_and(|metadata| metadata.is_file());
        }
        if preview.has_files && preview.has_directories {
            break;
        }
    }
    preview
}

#[tauri::command]
pub(crate) async fn preview_local_drop(paths: Vec<String>) -> Result<DropPreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview_paths(paths))
        .await
        .map_err(|error| format!("Drop preview task failed: {error}"))
}

#[cfg(test)]
mod tests;
