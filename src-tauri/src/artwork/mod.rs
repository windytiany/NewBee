pub(crate) mod artist;
pub(crate) mod cache;
mod clipboard;
pub(crate) mod encoding;
pub(crate) mod model;
pub(crate) mod reading;
mod request;
pub(crate) mod transfer;

use crate::database::Database;
use model::TrackArtwork;
use tauri::{ipc::Response, Manager};

use request::validate_size;

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

fn thumbnail(database: &Database, data: Vec<u8>, size: u32) -> Result<Vec<u8>, String> {
    #[cfg(test)]
    database.observe_artwork_decode();
    #[cfg(not(test))]
    let _ = database;
    encoding::thumbnail(&data, size)
}

#[cfg(test)]
mod tests;
