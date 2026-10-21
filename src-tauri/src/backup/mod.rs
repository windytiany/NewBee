mod archive;
mod restore;
#[cfg(test)]
mod tests;

use crate::{
    database::Database,
    locking::{ExclusiveWriteGuard, WriteState},
    settings::SettingsState,
};
use archive::{InterfaceState, Manifest, Workspace};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub(crate) struct BackupState {
    candidate: Mutex<Option<Candidate>>,
    restart_guard: Mutex<Option<ExclusiveWriteGuard>>,
    restore_error: Mutex<Option<String>>,
}
struct Candidate {
    token: String,
    workspace: Workspace,
}

pub(crate) struct DataDirectoryLease {
    _file: fs::File,
}

pub(crate) fn lock_data_directory(root: &Path) -> Result<DataDirectoryLease, String> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("application-data.lock"))
        .map_err(|error| error.to_string())?;
    file.try_lock()
        .map_err(|error| format!("应用数据正在使用中：{error}"))?;
    Ok(DataDirectoryLease { _file: file })
}

pub(crate) fn apply_pending_restore(root: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("backup-work-")
            && entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
        {
            fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    restore::apply(root).map(|restored| restored || root.join(restore::INTERFACE_FILE).exists())
}

pub(crate) fn abort_pending_restore(root: &Path) -> Result<(), String> {
    restore::abort(root)
}

impl BackupState {
    pub(crate) fn report_restore_error(&self, error: String) -> Result<(), String> {
        *self
            .restore_error
            .lock()
            .map_err(|error| error.to_string())? = Some(error);
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn get_backup_restore_error(
    state: tauri::State<'_, BackupState>,
) -> Result<Option<String>, String> {
    state
        .restore_error
        .lock()
        .map(|error| error.clone())
        .map_err(|error| error.to_string())
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn snapshot(app: &AppHandle, interface: InterfaceState) -> Result<Manifest, String> {
    archive::validate_interface(&interface)?;
    let session = crate::playback::session::backup_snapshot(app)?;
    let settings = app.state::<SettingsState>().get()?;
    Ok(Manifest::new(settings, session, interface))
}

fn export(app: &AppHandle, destination: &Path, interface: InterfaceState) -> Result<(), String> {
    let root = data_directory(app)?;
    let workspace = Workspace::new(&root)?;
    let manifest = snapshot(app, interface)?;
    let file = workspace.0.join("snapshot.newbee");
    archive::write(&app.state::<Database>(), &manifest, &file)?;
    archive::publish(&file, destination)
}

fn validate_export_destination(root: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or("备份路径无效")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    if parent.starts_with(&root) && !parent.starts_with(root.join("backups")) {
        return Err("不能覆盖应用数据文件".into());
    }
    if destination.exists() {
        let path = destination
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if path.starts_with(&root) && !path.starts_with(root.join("backups")) {
            return Err("不能覆盖应用数据文件".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn export_backup(
    app: AppHandle,
    path: String,
    interface: InterfaceState,
) -> Result<(), String> {
    let guard = app.state::<WriteState>().acquire_all()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let root = data_directory(&app)?;
        validate_export_destination(&root, Path::new(&path))?;
        export(&app, Path::new(&path), interface)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn inspect_backup(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackupState>();
        let mut candidate = state.candidate.try_lock().map_err(|_| "备份操作正在进行")?;
        let workspace = Workspace::new(&data_directory(&app)?)?;
        let snapshot = workspace.0.join("snapshot.newbee");
        archive::copy_synced(Path::new(&path), &snapshot)?;
        archive::read(&snapshot)?;
        let token = archive::nonce();
        *candidate = Some(Candidate {
            token: token.clone(),
            workspace,
        });
        Ok(token)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn restore_backup(
    app: AppHandle,
    token: String,
    interface: InterfaceState,
    backup_current: bool,
) -> Result<(), String> {
    let guard = app.state::<WriteState>().acquire_all()?;
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app = worker_app;
        let state = app.state::<BackupState>();
        let mut candidate = state.candidate.try_lock().map_err(|_| "备份操作正在进行")?;
        let current = candidate
            .as_ref()
            .filter(|candidate| candidate.token == token)
            .ok_or("请重新选择备份文件")?;
        let source = current.workspace.0.join("snapshot.newbee");
        let root = data_directory(&app)?;
        let current_manifest = if backup_current {
            Some(snapshot(&app, interface)?)
        } else {
            None
        };
        restore::stage(
            &root,
            &app.state::<Database>(),
            current_manifest.as_ref(),
            &source,
        )?;
        *state
            .restart_guard
            .lock()
            .map_err(|error| error.to_string())? = Some(guard);
        candidate.take();
        Ok::<_, String>(())
    })
    .await
    .map_err(|error| error.to_string())??;
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub(crate) async fn open_backups_directory(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = data_directory(&app)?.join("backups");
        fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_restored_interface_state(
    app: AppHandle,
) -> Result<Option<InterfaceState>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = data_directory(&app)?.join(restore::INTERFACE_FILE);
        let data = match fs::read(path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let state = serde_json::from_slice(&data).map_err(|error| error.to_string())?;
        archive::validate_interface(&state)?;
        Ok(Some(state))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn acknowledge_interface_restore(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::remove_file(data_directory(&app)?.join(restore::INTERFACE_FILE))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
