use crate::artwork::encoding::{validate_size, SIZES};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, FileTimes, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::SystemTime,
};

pub(crate) const ENCODING: &str = "webp1";
pub(crate) const CAPACITY: u64 = 256 * 1024 * 1024;
const MAGIC: &[u8; 8] = b"NBART001";
const HEADER: usize = 40;

pub(crate) struct Cache {
    root: PathBuf,
    capacity: u64,
    io: Mutex<()>,
    // Only temporary caches are removed on drop. Persistent caches belong to the app.
    _temporary: Option<tempfile::TempDir>,
}

impl Cache {
    pub(crate) fn open(root: &Path) -> io::Result<Self> {
        fs::create_dir_all(root)?;
        Ok(Self {
            root: root.into(),
            capacity: CAPACITY,
            io: Mutex::new(()),
            _temporary: None,
        })
    }

    pub(crate) fn temporary() -> io::Result<Self> {
        let directory = tempfile::Builder::new()
            .prefix("newbee-artwork-")
            .tempdir()?;
        let mut cache = Self::open(directory.path())?;
        cache._temporary = Some(directory);
        Ok(cache)
    }

    fn path(&self, content: &str, size: u32) -> Result<PathBuf, String> {
        validate_size(Some(size))?;
        if !valid_content(content) {
            return Err("Invalid artwork content identity".into());
        }
        Ok(self.root.join(format!("{content}-{size}-{ENCODING}.cache")))
    }

    pub(crate) fn read(&self, content: &str, size: u32) -> Result<Option<Vec<u8>>, String> {
        let path = self.path(content, size)?;
        let _guard = self.io.lock().map_err(|_| "Artwork cache is unavailable")?;
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => return Err("Artwork cache entry is not a regular file".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        if metadata.len() > self.capacity || metadata.len() < HEADER as u64 {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
            return Ok(None);
        }
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        if bytes.len() < HEADER
            || &bytes[..8] != MAGIC
            || Sha256::digest(&bytes[HEADER..])[..] != bytes[8..HEADER]
        {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
            return Ok(None);
        }
        OpenOptions::new()
            .write(true)
            .open(path)
            .and_then(|file| file.set_times(FileTimes::new().set_modified(SystemTime::now())))
            .map_err(|error| error.to_string())?;
        Ok(Some(bytes[HEADER..].to_vec()))
    }

    pub(crate) fn write(&self, content: &str, size: u32, bytes: &[u8]) -> Result<(), String> {
        let path = self.path(content, size)?;
        let _guard = self.io.lock().map_err(|_| "Artwork cache is unavailable")?;
        // Oversized entries can be returned to the caller without violating the disk budget.
        if bytes.len() as u64 + HEADER as u64 > self.capacity {
            return Ok(());
        }
        fs::create_dir_all(&self.root).map_err(|error| error.to_string())?;
        let mut temporary = tempfile::Builder::new()
            .prefix("pending-")
            .suffix(".tmp")
            .tempfile_in(&self.root)
            .map_err(|error| error.to_string())?;
        temporary
            .write_all(MAGIC)
            .map_err(|error| error.to_string())?;
        temporary
            .write_all(&Sha256::digest(bytes))
            .and_then(|_| temporary.write_all(bytes))
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|error| error.to_string())?;
        temporary.persist(path).map_err(|error| error.to_string())?;
        self.evict(None)
    }

    pub(crate) fn clean(&self, live: &HashSet<String>) -> Result<(), String> {
        let _guard = self.io.lock().map_err(|_| "Artwork cache is unavailable")?;
        self.evict(Some(live))
    }

    fn evict(&self, live: Option<&HashSet<String>>) -> Result<(), String> {
        let mut entries = Vec::new();
        let mut total = 0;
        let directory = match fs::read_dir(&self.root) {
            Ok(directory) => directory,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        for entry in directory {
            let entry = entry.map_err(|error| error.to_string())?;
            // Never follow symlinks or recurse into unrelated directories.
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let owned = name.ends_with(".cache")
                || (name.starts_with("pending-") && name.ends_with(".tmp"));
            if !owned {
                continue;
            }
            let current = name
                .strip_suffix(&format!("-{ENCODING}.cache"))
                .and_then(|key| {
                    let (content, size) = key.rsplit_once('-')?;
                    let size = size.parse::<u32>().ok()?;
                    (valid_content(content) && SIZES.contains(&size)).then_some(content)
                });
            if current.is_none_or(|content| live.is_some_and(|live| !live.contains(content))) {
                fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
                continue;
            }
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            total += metadata.len();
            entries.push((
                metadata.modified().map_err(|error| error.to_string())?,
                entry.path(),
                metadata.len(),
            ));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        for (_, path, length) in entries {
            if total <= self.capacity {
                break;
            }
            fs::remove_file(path).map_err(|error| error.to_string())?;
            total -= length;
        }
        Ok(())
    }
}

fn valid_content(content: &str) -> bool {
    content.len() == 97
        && content.as_bytes()[64] == b'-'
        && content.bytes().enumerate().all(|(index, byte)| {
            index == 64 || byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
        })
}

#[cfg(test)]
#[path = "tests/cache.rs"]
mod tests;
