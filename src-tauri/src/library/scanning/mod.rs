use crate::{
    library::{
        error::CommandError,
        model::ImportResult,
        synchronization::{
            commands,
            configuration::{Folder, Mode},
        },
    },
    locking::WriteState,
    settings::SettingsState,
};
use tauri::State;

#[tauri::command]
pub(crate) fn get_scan_folders(settings: State<'_, SettingsState>) -> Result<Vec<String>, String> {
    Ok(settings.get()?.scan_folders)
}

#[tauri::command]
pub(crate) fn save_scan_folders(
    settings: State<'_, SettingsState>,
    write: State<'_, WriteState>,
    folders: Vec<String>,
) -> Result<Vec<String>, String> {
    let _guard = write.acquire_settings()?;
    if folders
        .iter()
        .any(|path| !std::path::Path::new(path).is_absolute())
    {
        return Err("扫描路径必须是绝对路径".into());
    }
    let mut unique = std::collections::HashSet::new();
    if folders.iter().any(|path| !unique.insert(path)) {
        return Err("扫描文件夹不能重复".into());
    }
    settings.update_scan_folders(folders.clone())?;
    Ok(folders)
}

#[tauri::command]
pub(crate) async fn scan_library<R: tauri::Runtime>(
    paths: Vec<String>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
    write: State<'_, WriteState>,
) -> Result<ImportResult, CommandError> {
    let folders = paths
        .into_iter()
        .map(|path| Folder {
            path,
            mode: Mode::Startup,
            enabled: true,
        })
        .collect();
    commands::run(operation_id, app, write, Some(folders)).await
}
