use super::{
    ingest::ingest,
    model::{FileResult, InboxRead},
    reading::refresh,
    registration::{register, register_directories},
};
use crate::{database::Database, locking::WriteState};
use tauri::{Manager, State};

#[tauri::command]
pub(crate) async fn read_inbox<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<InboxRead, String> {
    crate::database::blocking(app, refresh).await
}

#[tauri::command]
pub(crate) async fn register_inbox<R: tauri::Runtime>(
    paths: Vec<String>,
    directory: bool,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<FileResult>, String> {
    let guard = write.acquire_task(operation_id.as_deref()).await?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::tasks::with_operation(operation_id, || {
            let _guard = guard;
            let database = app.state::<Database>();
            if directory {
                register_directories(&database, paths)
            } else {
                register(&database, paths)
            }
        })
    })
    .await
    .map_err(|error| format!("Inbox 登记失败：{error}"))
}

#[tauri::command]
pub(crate) async fn remove_inbox<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<(), String> {
    let guard = write.acquire()?;
    crate::database::blocking(app, move |database| {
        let _guard = guard;
        for id in track_ids {
            database.remove_inbox_track(id)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn ingest_inbox<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<Vec<FileResult>, String> {
    crate::tasks::validate(
        &app.state::<Database>(),
        &track_ids,
        operation_id.as_deref(),
        &[],
    )?;
    let guard = write.acquire_task(operation_id.as_deref()).await?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::tasks::with_operation(operation_id, || {
            let _guard = guard;
            ingest(&app.state::<Database>(), track_ids)
        })
    })
    .await
    .map_err(|error| format!("Inbox 入库失败：{error}"))
}
