use crate::tracks::discovery::has_supported_extension;
use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Stamp {
    size: u64,
    modified: SystemTime,
}

// Include non-audio files so directory artwork and sidecar changes also settle.
pub(super) type Inventory = BTreeMap<PathBuf, Stamp>;

pub(super) fn inspect(root: &Path) -> Result<Inventory, String> {
    let canonical = fs::canonicalize(root).map_err(|error| error.to_string())?;
    if canonical != root || !root.is_dir() {
        return Err("监视文件夹不可用或已变为链接".into());
    }
    let mut inventory = Inventory::new();
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if fs::canonicalize(&path).map_err(|error| error.to_string())? != path {
                return Err("监视路径在读取期间发生变化".into());
            }
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file() {
                let metadata = entry.metadata().map_err(|error| error.to_string())?;
                inventory.insert(
                    path,
                    Stamp {
                        size: metadata.len(),
                        modified: metadata.modified().map_err(|error| error.to_string())?,
                    },
                );
            }
        }
    }
    Ok(inventory)
}

pub(super) fn audio(inventory: &Inventory) -> Vec<PathBuf> {
    inventory
        .keys()
        .filter(|path| has_supported_extension(path))
        .cloned()
        .collect()
}

pub(super) fn missing(path: &Path) -> bool {
    matches!(fs::symlink_metadata(path), Err(error) if error.kind() == ErrorKind::NotFound)
}
