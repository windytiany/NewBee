use crate::tracks::has_supported_extension;
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
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Inventory {
    files: BTreeMap<PathBuf, Stamp>,
    links: u64,
}

impl Inventory {
    pub(super) fn skipped(&self) -> u64 {
        self.links
            + self
                .files
                .keys()
                .filter(|path| !has_supported_extension(path))
                .count() as u64
    }
}

pub(super) fn inspect(root: &Path) -> Result<Inventory, String> {
    let canonical = fs::canonicalize(root).map_err(|error| error.to_string())?;
    if canonical != root || !root.is_dir() {
        return Err("同步文件夹不可用或已变为链接".into());
    }
    let mut inventory = Inventory {
        files: BTreeMap::new(),
        links: 0,
    };
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                inventory.links += 1;
                continue;
            }
            let path = entry.path();
            if fs::canonicalize(&path).map_err(|error| error.to_string())? != path {
                return Err("同步路径在读取期间发生变化".into());
            }
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file() {
                let metadata = entry.metadata().map_err(|error| error.to_string())?;
                inventory.files.insert(
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
        .files
        .keys()
        .filter(|path| has_supported_extension(path))
        .cloned()
        .collect()
}

pub(super) fn missing(path: &Path) -> bool {
    matches!(fs::symlink_metadata(path), Err(error) if error.kind() == ErrorKind::NotFound)
}
