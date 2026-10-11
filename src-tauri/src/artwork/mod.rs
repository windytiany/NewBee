mod clipboard;
pub(crate) mod transfer;

use crate::database::{Database, TrackArtwork};
use std::io::Cursor;
use tauri::{ipc::Response, Manager};

// Shared with frontend artwork requests and the SQL thumbnail constraint.
pub(crate) const MAX_ARTWORK_SIZE: u32 = 4096;

#[tauri::command]
pub(crate) async fn get_track_artwork<R: tauri::Runtime>(
    track_id: i64,
    size: Option<u32>,
    app: tauri::AppHandle<R>,
) -> Result<Response, String> {
    validate_size(size)?;
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        database
            .track_artwork_bytes(track_id, size, |data, size| {
                thumbnail(&database, data, size)
            })
            .map(Response::new)
    })
    .await
    .map_err(|error| format!("读取曲目封面失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_album_artwork<R: tauri::Runtime>(
    album_artist: Option<String>,
    album: Option<String>,
    size: Option<u32>,
    app: tauri::AppHandle<R>,
) -> Result<Response, String> {
    validate_size(size)?;
    tauri::async_runtime::spawn_blocking(move || {
        let database = app.state::<Database>();
        if size.is_none() {
            let artwork = database.get_album_artwork(album_artist, album)?;
            return Ok(Response::new(match artwork {
                Some(TrackArtwork::Available { data, .. }) => data,
                _ => Vec::new(),
            }));
        }
        database
            .album_artwork_bytes(album_artist, album, size, |data, size| {
                thumbnail(&database, data, size)
            })
            .map(Response::new)
    })
    .await
    .map_err(|error| format!("读取专辑封面失败：{error}"))?
}

fn validate_size(size: Option<u32>) -> Result<(), String> {
    if size.is_some_and(|size| size == 0 || size > MAX_ARTWORK_SIZE) {
        return Err(format!("封面尺寸必须在 1 到 {MAX_ARTWORK_SIZE} 之间"));
    }
    Ok(())
}

fn thumbnail(database: &Database, data: Vec<u8>, size: u32) -> Result<Vec<u8>, String> {
    #[cfg(test)]
    database.observe_artwork_decode();
    #[cfg(not(test))]
    let _ = database;
    let image = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|error| format!("识别封面格式失败：{error}"))?
        .decode()
        .map_err(|error| format!("解码封面失败：{error}"))?;
    let mut output = Cursor::new(Vec::new());
    image
        .thumbnail(size, size)
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| format!("生成封面缩略图失败：{error}"))?;
    Ok(output.into_inner())
}

#[cfg(test)]
mod tests;
