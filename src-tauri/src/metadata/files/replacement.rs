use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Seek},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

/// Own the entire copy transaction. Business validation runs on the closed,
/// synchronized copy; neither a write nor a validation failure can commit it.
pub(super) fn replace(
    path: &Path,
    metadata: &Metadata,
    write: impl FnOnce(&Path, &mut File) -> Result<(), String>,
    verify: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let (temporary, mut destination) = TemporaryFile::create(path)?;
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    io::copy(&mut source, &mut destination)
        .map_err(|error| format!("创建安全副本失败：{error}"))?;
    drop(source);
    destination.rewind().map_err(|error| error.to_string())?;
    write(temporary.path(), &mut destination)?;
    destination.sync_all().map_err(|error| error.to_string())?;
    drop(destination);
    verify(temporary.path())?;
    let current = fs::metadata(path).map_err(|error| error.to_string())?;
    if current.len() != metadata.len() || current.modified().ok() != metadata.modified().ok() {
        return Err("文件已变化，请重试".to_owned());
    }
    fs::set_permissions(temporary.path(), metadata.permissions())
        .map_err(|error| error.to_string())?;
    fs::rename(temporary.path(), path)
        .map_err(|error| format!("替换文件失败，原文件未修改：{error}"))?;
    Ok(())
}

pub(super) struct TemporaryFile(PathBuf);

impl TemporaryFile {
    pub(super) fn path(&self) -> &Path {
        &self.0
    }

    pub(super) fn create(path: &Path) -> Result<(Self, File), String> {
        let parent = path.parent().ok_or_else(|| "文件没有父目录".to_owned())?;
        loop {
            let temporary = parent.join(format!(
                ".newbee-metadata-{}-{}.tmp",
                std::process::id(),
                NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed)
            ));
            match OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&temporary)
            {
                Ok(file) => return Ok((Self(temporary), file)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("无法创建安全副本：{error}")),
            }
        }
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.0) {
            if error.kind() != io::ErrorKind::NotFound {
                log::warn!(
                    "Could not clean metadata temporary file '{}': {error}",
                    self.0.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn failed_write_keeps_original_and_removes_partial_copy() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("track.wav");
        fs::write(&path, b"original").unwrap();
        let error = replace(
            &path,
            &fs::metadata(&path).unwrap(),
            |_, file| {
                file.write_all(b"partial").unwrap();
                Err("write failed".into())
            },
            |_| panic!("must not validate a failed write"),
        )
        .unwrap_err();
        assert_eq!(error, "write failed");
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_validation_keeps_original_and_removes_written_copy() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("track.wav");
        fs::write(&path, b"original").unwrap();
        let result = replace(
            &path,
            &fs::metadata(&path).unwrap(),
            |_, file| {
                file.write_all(b"modified")
                    .map_err(|error| error.to_string())
            },
            |copy| {
                assert_eq!(fs::read(copy).unwrap(), b"modified");
                assert_eq!(fs::read(&path).unwrap(), b"original");
                Err("validation failed".into())
            },
        );
        assert_eq!(result.unwrap_err(), "validation failed");
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn success_replaces_only_after_validation_and_cleans_copy() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("track.wav");
        fs::write(&path, b"original").unwrap();
        let metadata = fs::metadata(&path).unwrap();
        replace(
            &path,
            &metadata,
            |copy, file| {
                assert_ne!(copy, path);
                assert_eq!(fs::read(copy).unwrap(), b"original");
                file.write_all(b"modified")
                    .map_err(|error| error.to_string())
            },
            |copy| {
                assert_eq!(fs::read(copy).unwrap(), b"modified");
                assert_eq!(fs::read(&path).unwrap(), b"original");
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"modified");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().readonly(),
            metadata.permissions().readonly()
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn changed_original_is_not_overwritten_after_validation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("track.wav");
        fs::write(&path, b"original").unwrap();
        let result = replace(
            &path,
            &fs::metadata(&path).unwrap(),
            |_, file| {
                file.write_all(b"modified")
                    .map_err(|error| error.to_string())
            },
            |_| {
                fs::write(&path, b"external change").unwrap();
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "文件已变化，请重试");
        assert_eq!(fs::read(&path).unwrap(), b"external change");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
