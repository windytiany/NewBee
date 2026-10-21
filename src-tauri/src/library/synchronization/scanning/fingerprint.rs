use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Serialize, PartialEq, Eq)]
struct FileStamp {
    size: u64,
    modified: u128,
    created: Option<u128>,
    readonly: bool,
}

fn stamp(path: &Path) -> Result<FileStamp, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("File state '{}': {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("Not a regular file: {}", path.display()));
    }
    Ok(FileStamp {
        size: metadata.len(),
        modified: metadata
            .modified()
            .map_err(|error| error.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos(),
        created: metadata
            .created()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_nanos()),
        readonly: metadata.permissions().readonly(),
    })
}

pub(super) fn pictures(pictures: &[(PathBuf, Vec<u8>)]) -> Result<String, String> {
    let states = pictures
        .iter()
        .map(|(path, bytes)| Ok((path.to_string_lossy().into_owned(), content(path, bytes)?)))
        .collect::<Result<Vec<_>, String>>()?;
    serde_json::to_string(&states).map_err(|error| error.to_string())
}

pub(super) fn track(
    audio: &Path,
    directory: &str,
    linked: &[(i64, String)],
    images: &mut HashMap<String, Result<String, String>>,
) -> Result<String, String> {
    let sources = linked
        .iter()
        .map(|(id, path)| {
            let fingerprint = images
                .entry(path.clone())
                .or_insert_with(|| {
                    let bytes = fs::read(path)
                        .map_err(|error| format!("Linked artwork '{path}': {error}"))?;
                    content(Path::new(path), &bytes)
                })
                .as_ref()
                .map_err(Clone::clone)?;
            Ok((*id, path, fingerprint.clone()))
        })
        .collect::<Result<Vec<_>, String>>()?;
    // Version the fingerprint separately from the database schema, so new scan semantics invalidate it.
    serde_json::to_string(&(2, stamp(audio)?, directory, sources))
        .map_err(|error| error.to_string())
}

fn content(path: &Path, bytes: &[u8]) -> Result<String, String> {
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    serde_json::to_string(&(stamp(path)?, digest)).map_err(|error| error.to_string())
}
