use crate::database::{Database, TrackArtwork};
use std::io::Cursor;
use tauri::{ipc::Response, Manager};

const THUMBNAIL_SIZE: u32 = 80;

#[tauri::command]
pub(crate) async fn get_track_artwork<R: tauri::Runtime>(
    track_id: i64,
    thumbnail: bool,
    app: tauri::AppHandle<R>,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let artwork = app.state::<Database>().get_track_artwork(track_id)?;
        artwork_response(artwork, thumbnail)
    })
    .await
    .map_err(|error| format!("读取曲目封面失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_album_artwork<R: tauri::Runtime>(
    album_artist: Option<String>,
    album: Option<String>,
    app: tauri::AppHandle<R>,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let artwork = app
            .state::<Database>()
            .get_album_artwork(album_artist, album)?;
        artwork_response(artwork, false)
    })
    .await
    .map_err(|error| format!("读取专辑封面失败：{error}"))?
}

fn artwork_response(artwork: Option<TrackArtwork>, thumbnail: bool) -> Result<Response, String> {
    let Some(TrackArtwork::Available { data, .. }) = artwork else {
        return Ok(Response::new(Vec::<u8>::new()));
    };
    if !thumbnail {
        return Ok(Response::new(data));
    }
    let image = image::ImageReader::new(Cursor::new(data))
        .with_guessed_format()
        .map_err(|error| format!("识别封面格式失败：{error}"))?
        .decode()
        .map_err(|error| format!("解码封面失败：{error}"))?;
    let mut output = Cursor::new(Vec::new());
    image
        .thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| format!("生成封面缩略图失败：{error}"))?;
    Ok(Response::new(output.into_inner()))
}

#[cfg(test)]
mod tests;
