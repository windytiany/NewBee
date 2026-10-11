use crate::{database::Database, playback::session::SavedSession, settings::Settings};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) const FORMAT_VERSION: u32 = 1;
pub(super) const INTERFACE_KEYS: &[&str] = &[
    "newbee.active-page",
    "newbee.sidebar-layout",
    "newbee.library-selection",
    "newbee.playlist-selection",
    "newbee.playing-presentation",
    "newbee.scroll-positions",
];
pub(super) type InterfaceState = BTreeMap<String, String>;
const MAX_MANIFEST_BYTES: usize = 4 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Manifest {
    pub format_version: u32,
    pub app_version: String,
    pub settings: Settings,
    pub session: SavedSession,
    pub interface: InterfaceState,
}

pub(super) fn validate_interface(state: &InterfaceState) -> Result<(), String> {
    if state
        .keys()
        .any(|key| !INTERFACE_KEYS.contains(&key.as_str()))
    {
        return Err("备份包含未知界面状态".into());
    }
    for (key, value) in state {
        if value.len() > MAX_MANIFEST_BYTES {
            return Err("备份界面状态过大".into());
        }
        let valid = match key.as_str() {
            "newbee.active-page" => ["Playing", "Library", "Playlist"].contains(&value.as_str()),
            "newbee.playing-presentation" => ["track", "lyrics", "both"].contains(&value.as_str()),
            "newbee.playlist-selection" => value
                .parse::<u64>()
                .is_ok_and(|id| id > 0 && id <= 9_007_199_254_740_991),
            _ => serde_json::from_str::<serde_json::Value>(value)
                .is_ok_and(|value| value.is_object()),
        };
        if !valid {
            return Err(format!("界面状态无效：{key}"));
        }
    }
    Ok(())
}

impl Manifest {
    pub fn new(settings: Settings, session: SavedSession, interface: InterfaceState) -> Self {
        Self {
            format_version: FORMAT_VERSION,
            app_version: env!("CARGO_PKG_VERSION").into(),
            settings,
            session,
            interface,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.format_version != FORMAT_VERSION || self.app_version != env!("CARGO_PKG_VERSION") {
            return Err("备份与当前应用版本不兼容".into());
        }
        self.session.validate()?;
        validate_interface(&self.interface)?;
        let mut providers = std::collections::HashSet::new();
        if self
            .settings
            .lyrics_providers
            .iter()
            .any(|provider| !providers.insert(*provider))
        {
            return Err("备份歌词来源重复".into());
        }
        Ok(())
    }
}

pub(super) fn read(path: &Path) -> Result<Manifest, String> {
    let connection = crate::database::backup::validate_backup_database(path)?;
    let (size, count): (i64, i64) = connection.query_row(
        "SELECT coalesce(max(length(CAST(json AS BLOB))), 0), count(*) FROM newbee_backup_manifest", [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|error| format!("不是有效的 NewBee 备份：{error}"))?;
    if count != 1 || size > MAX_MANIFEST_BYTES as i64 {
        return Err("备份清单无效".into());
    }
    let serialized: String = connection
        .query_row("SELECT json FROM newbee_backup_manifest", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    let manifest: Manifest =
        serde_json::from_str(&serialized).map_err(|error| format!("备份清单无效：{error}"))?;
    manifest.validate()?;
    Ok(manifest)
}

pub(super) fn write(
    database: &Database,
    manifest: &Manifest,
    destination: &Path,
) -> Result<(), String> {
    manifest.validate()?;
    let serialized = serde_json::to_string(manifest).map_err(|error| error.to_string())?;
    if serialized.len() > MAX_MANIFEST_BYTES {
        return Err("备份清单过大".into());
    }
    database.backup_snapshot(destination)?;
    let connection = Connection::open(destination).map_err(|error| error.to_string())?;
    connection
        .execute_batch("CREATE TABLE newbee_backup_manifest (json TEXT NOT NULL);")
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO newbee_backup_manifest (json) VALUES (?1)",
            params![serialized],
        )
        .map_err(|error| error.to_string())?;
    connection.close().map_err(|(_, error)| error.to_string())?;
    fs::OpenOptions::new()
        .write(true)
        .open(destination)
        .and_then(|file| file.sync_all())
        .map_err(|error| error.to_string())
}

pub(super) fn nonce() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

pub(super) fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|error| error.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())
}

pub(super) fn copy_synced(source: &Path, destination: &Path) -> Result<(), String> {
    let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut output = fs::File::create(destination).map_err(|error| error.to_string())?;
    std::io::copy(&mut input, &mut output)
        .and_then(|_| output.sync_all())
        .map_err(|error| error.to_string())
}

pub(super) fn publish(source: &Path, destination: &Path) -> Result<(), String> {
    let temporary = destination.with_extension(format!("{}.partial", nonce()));
    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
        std::io::copy(&mut input, &mut output)
            .and_then(|_| output.sync_all())
            .map_err(|error| error.to_string())?;
        drop(output);
        fs::rename(&temporary, destination).map_err(|error| format!("无法写入备份：{error}"))
    })();
    if result.is_err() {
        remove_file(&temporary);
    }
    result
}

pub(super) fn remove_file(path: &Path) {
    if let Err(error) = fs::remove_file(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("Could not remove backup file {}: {error}", path.display());
        }
    }
}

pub(super) struct Workspace(pub PathBuf);
impl Workspace {
    pub fn new(root: &Path) -> Result<Self, String> {
        let path = root.join(format!("backup-work-{}", nonce()));
        fs::create_dir(&path).map_err(|error| error.to_string())?;
        Ok(Self(path))
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            log::warn!("Could not remove backup workspace: {error}");
        }
    }
}
