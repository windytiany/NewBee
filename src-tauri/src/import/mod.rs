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

#[cfg(test)]
mod tests;
