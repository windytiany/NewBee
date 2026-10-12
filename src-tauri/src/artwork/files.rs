use std::path::Path;
use tauri::ipc::Response;

#[tauri::command]
pub(crate) async fn get_file_artwork(path: String, size: Option<u32>) -> Result<Response, String> {
    super::request::validate_size(size)?;
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = crate::metadata::files::read_track(Path::new(&path))?
            .ok_or_else(|| "Unsupported audio file".to_owned())?;
        let Some(artwork) = snapshot.artwork else {
            return Ok(Response::new(Vec::<u8>::new()));
        };
        let bytes = match size {
            Some(size) => super::encoding::thumbnail(&artwork.image, size)?,
            None => artwork.image,
        };
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|error| error.to_string())?
}
