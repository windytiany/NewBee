use super::archive::{self, Manifest, Workspace};
use rusqlite::Connection;
use std::{fs, path::Path};

pub(super) const PENDING_FILE: &str = "restore-pending.newbee";
pub(super) const INTERFACE_FILE: &str = "restored-interface.json";
const ROLLBACK_DIRECTORY: &str = "restore-rollback";
const FILES: &[&str] = &[
    "music-library.sqlite3",
    "settings.json",
    "playback-session.json",
    INTERFACE_FILE,
    "music-library.sqlite3-wal",
    "music-library.sqlite3-shm",
];

pub(super) fn stage(
    root: &Path,
    database: &crate::database::Database,
    current: Option<&Manifest>,
    source: &Path,
) -> Result<(), String> {
    archive::read(source)?;
    if let Some(current) = current {
        let directory = root.join("backups");
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let workspace = Workspace::new(root)?;
        let automatic = workspace.0.join("before-restore.newbee");
        archive::write(database, current, &automatic)?;
        archive::publish(
            &automatic,
            &directory.join(format!("before-restore-{}.newbee", archive::nonce())),
        )?;
    }
    archive::publish(source, &root.join(PENDING_FILE))
}

pub(super) fn abort(root: &Path) -> Result<(), String> {
    recover(root)?;
    cleanup(root)
}

fn prepare_payload(root: &Path, source: &Path, manifest: &Manifest) -> Result<Workspace, String> {
    let workspace = Workspace::new(root)?;
    let database = workspace.0.join(FILES[0]);
    archive::copy_synced(source, &database)?;
    let connection = Connection::open(&database).map_err(|error| error.to_string())?;
    connection
        .execute_batch("DROP TABLE newbee_backup_manifest;")
        .map_err(|error| error.to_string())?;
    connection.close().map_err(|(_, error)| error.to_string())?;
    archive::write_synced(
        &workspace.0.join(FILES[1]),
        &serde_json::to_vec(&manifest.settings).map_err(|error| error.to_string())?,
    )?;
    archive::write_synced(
        &workspace.0.join(FILES[2]),
        &serde_json::to_vec(&manifest.session).map_err(|error| error.to_string())?,
    )?;
    archive::write_synced(
        &workspace.0.join(INTERFACE_FILE),
        &serde_json::to_vec(&manifest.interface).map_err(|error| error.to_string())?,
    )?;
    Ok(workspace)
}

fn cleanup(root: &Path) -> Result<(), String> {
    let rollback = root.join(ROLLBACK_DIRECTORY);
    // Remove the pending import first, so an interrupted cleanup cannot reapply it.
    if root.join(PENDING_FILE).exists() {
        fs::remove_file(root.join(PENDING_FILE)).map_err(|error| error.to_string())?;
    }
    if rollback.exists() {
        fs::remove_dir_all(rollback).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn recover(root: &Path) -> Result<bool, String> {
    let rollback = root.join(ROLLBACK_DIRECTORY);
    if !rollback.exists() {
        return Ok(false);
    }
    if rollback.join("committed").exists() {
        cleanup(root)?;
        return Ok(true);
    }
    let journal = rollback.join("prepared.json");
    if !journal.exists() {
        // No live file is changed until the complete rollback journal is published.
        fs::remove_dir_all(rollback).map_err(|error| error.to_string())?;
        return Ok(false);
    }
    let present: Vec<String> =
        serde_json::from_slice(&fs::read(journal).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    if present.iter().any(|name| !FILES.contains(&name.as_str())) {
        return Err("恢复回滚记录无效".into());
    }
    for name in FILES {
        let destination = root.join(name);
        if present.iter().any(|present| present == name) {
            archive::publish(&rollback.join(name), &destination)?;
        } else if destination.exists() {
            fs::remove_file(destination).map_err(|error| format!("恢复原数据失败：{error}"))?;
        }
    }
    cleanup(root)?;
    Ok(false)
}

pub(super) fn apply(root: &Path) -> Result<bool, String> {
    let recovered = recover(root)?;
    let pending = root.join(PENDING_FILE);
    if !pending.exists() {
        return Ok(recovered);
    }
    let manifest = archive::read(&pending)?;
    let payload = prepare_payload(root, &pending, &manifest)?;
    let rollback = root.join(ROLLBACK_DIRECTORY);
    fs::create_dir(&rollback).map_err(|error| error.to_string())?;
    let result = (|| {
        let mut present = Vec::new();
        for name in FILES {
            let path = root.join(name);
            if path.exists() {
                archive::copy_synced(&path, &rollback.join(name))?;
                present.push(*name);
            }
        }
        let journal = payload.0.join("prepared.json");
        archive::write_synced(
            &journal,
            &serde_json::to_vec(&present).map_err(|error| error.to_string())?,
        )?;
        archive::publish(&journal, &rollback.join("prepared.json"))?;
        for name in &FILES[..4] {
            archive::publish(&payload.0.join(name), &root.join(name))?;
        }
        for name in &FILES[4..] {
            let path = root.join(name);
            if path.exists() {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
        let marker = payload.0.join("committed");
        archive::write_synced(&marker, b"complete")?;
        archive::publish(&marker, &rollback.join("committed"))?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        recover(root).map_err(|rollback| format!("恢复失败：{error}；回滚失败：{rollback}"))?;
        return Err(format!("恢复失败，原数据已保留：{error}"));
    }
    if let Err(error) = cleanup(root) {
        log::warn!("Could not clean up completed restore: {error}");
    }
    Ok(true)
}

#[cfg(test)]
pub(super) fn rollback_directory() -> &'static str {
    ROLLBACK_DIRECTORY
}
