pub(crate) mod prefix;
use crate::{
    database::Database, library::synchronization::SynchronizationState, locking::WriteState,
    settings::SettingsState,
};
use std::collections::HashSet;
use tauri::{Emitter, Manager};

fn remap(
    database: &Database,
    settings: &SettingsState,
    old: &str,
    new: &str,
) -> Result<usize, String> {
    let prefix = prefix::Prefix::new(old, new)?;
    let mut previous = None;
    let mut changed = 0;
    let result = database.remap_paths_with(old, new, || {
        settings.update_folders(|folders| {
            previous = Some(folders.clone());
            let mut paths = HashSet::new();
            for folder in folders.iter_mut() {
                if let Some(path) = prefix.replace(&folder.path) {
                    folder.path = path;
                    changed += 1;
                }
                if !paths.insert(prefix::normalize_windows_path(&folder.path)) {
                    return Err("重映射后同步文件夹冲突，未修改任何路径".into());
                }
            }
            Ok(())
        })
    });
    match result {
        Ok(count) => Ok(count + changed),
        Err(error) => {
            // SQL preparation and settings persistence failures leave both stores unchanged.
            // If committing SQL failed after persistence, restore the folder configuration.
            if let Some(previous) = previous {
                if settings.get()?.synchronization_folders != previous {
                    settings
                        .update_folders(|folders| {
                            *folders = previous;
                            Ok(())
                        })
                        .map_err(|rollback| format!("{error}；恢复同步配置失败：{rollback}"))?;
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn remap_paths<R: tauri::Runtime>(
    old_path: String,
    new_path: String,
    app: tauri::AppHandle<R>,
) -> Result<usize, String> {
    let guard = app.state::<WriteState>().acquire_all()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let count = remap(
            &app.state::<Database>(),
            &app.state::<SettingsState>(),
            &old_path,
            &new_path,
        )?;
        if count > 0 {
            let prefix = prefix::Prefix::new(&old_path, &new_path)?;
            app.state::<SynchronizationState>()
                .invalidate_paths(|path| prefix.replace(path).is_some());
            if let Err(error) = app.emit("library-synchronization-changed", ()) {
                log::warn!("Could not publish path remapping: {error}");
            }
        }
        Ok(count)
    })
    .await
    .map_err(|error| format!("路径重映射失败：{error}"))?
}

#[cfg(test)]
mod tests;
