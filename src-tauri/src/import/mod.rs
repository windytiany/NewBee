use crate::library::import::has_supported_extension;
use crate::metadata::files::FileTrack;
use std::path::Path;

fn readable_files(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| {
            let file = Path::new(path);
            has_supported_extension(file) && file.is_file() && FileTrack::read(path).is_ok()
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn readable_audio_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || readable_files(paths))
        .await
        .map_err(|error| format!("Audio file validation task failed: {error}"))
}

#[cfg(test)]
mod tests;
