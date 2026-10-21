use super::{
    configuration::{self, Folder},
    publish, reconciliation, Progress, SynchronizationState,
};
use crate::{
    database::Database,
    library::{error::CommandError, model::ImportResult},
    locking::WriteState,
    settings::SettingsState,
};
use tauri::{Emitter, Manager, State};

#[tauri::command]
pub(crate) fn get_synchronization_folders(
    settings: State<'_, SettingsState>,
) -> Result<Vec<Folder>, String> {
    Ok(settings.get()?.synchronization_folders)
}

#[tauri::command]
pub(crate) async fn save_synchronization_folders<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
    mut folders: Vec<Folder>,
) -> Result<Vec<Folder>, String> {
    let guard = write.acquire_settings()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        app.state::<SettingsState>().update_folders(|previous| {
            configuration::normalize(&mut folders, previous)?;
            *previous = folders.clone();
            Ok(())
        })?;
        Ok(folders)
    })
    .await
    .map_err(|error| format!("保存同步文件夹失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn synchronize_library<R: tauri::Runtime>(
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<ImportResult, CommandError> {
    let guard = write.acquire().map_err(CommandError::busy)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::logging::with_operation(operation_id, || {
            let _guard = guard;
            let settings = app.state::<SettingsState>().get()?;
            let state = app.state::<SynchronizationState>();
            let database = app.state::<Database>();
            let path = settings
                .synchronization_folders
                .iter()
                .find(|folder| folder.enabled)
                .map(|folder| folder.path.clone())
                .unwrap_or_default();
            let mut last_update = std::time::Instant::now();
            let result = reconciliation::run(
                &database,
                &state,
                &settings.synchronization_folders,
                settings.scan_replay_gain,
                |completed, total| {
                    if completed != 0
                        && completed != total
                        && last_update.elapsed() < std::time::Duration::from_millis(100)
                    {
                        return;
                    }
                    last_update = std::time::Instant::now();
                    state.progress(Some(Progress {
                        path: path.clone(),
                        completed,
                        total,
                    }));
                    publish(&app);
                },
            );
            state.progress(None);
            publish(&app);
            if let Ok(result) = &result {
                if result.added + result.updated > 0 {
                    if let Err(error) = app.emit("library-synchronization-imported", result) {
                        log::warn!("Could not publish synchronization result: {error}");
                    }
                }
            }
            result
        })
    })
    .await
    .map_err(|error| CommandError::scan(error.to_string()))?
    .map_err(CommandError::scan)
}
