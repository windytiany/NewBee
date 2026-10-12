mod discogs;
mod lookup;
mod storage;

pub(crate) use lookup::LookupState;

use crate::locking::write::WriteState;
use tauri::{ipc::Response, Manager};

#[tauri::command]
pub(crate) async fn get_artist_photo<R: tauri::Runtime>(
    artist: String,
    app: tauri::AppHandle<R>,
) -> Result<Response, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取照片目录失败：{error}"))?
        .join("artists")
        .join("photos");
    tauri::async_runtime::spawn_blocking(move || {
        storage::read(&directory, &artist).map(Response::new)
    })
    .await
    .map_err(|error| format!("读取演出者照片失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn find_artist_photo<R: tauri::Runtime>(
    artist: String,
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取照片目录失败：{error}"))?
        .join("artists")
        .join("photos");
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<LookupState>()
            .find(&directory, &artist, &app.state::<WriteState>())
    })
    .await
    .map_err(|error| format!("获取演出者照片失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn save_artist_photo<R: tauri::Runtime>(
    artist: String,
    data: Vec<u8>,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("读取照片目录失败：{error}"))?
        .join("artists")
        .join("photos");
    let guard = app.state::<WriteState>().acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        storage::save(&directory, &artist, &data)
    })
    .await
    .map_err(|error| format!("保存演出者照片失败：{error}"))?
}
