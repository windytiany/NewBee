use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

pub(crate) struct TestFiles(pub(crate) PathBuf);

impl TestFiles {
    pub(crate) fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "newbee-library-import-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir(&directory).unwrap();
        Self(fs::canonicalize(directory).unwrap())
    }

    pub(crate) fn wav(&self, name: &str) -> String {
        // One second of unsigned 8-bit mono PCM at 8 kHz.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&8036_u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8000_u32.to_le_bytes());
        bytes.extend_from_slice(&8000_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&8000_u32.to_le_bytes());
        bytes.extend_from_slice(&[128; 8000]);
        self.write(name, &bytes)
    }

    pub(crate) fn write(&self, name: &str, bytes: &[u8]) -> String {
        let path = self.0.join(name);
        fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }
}

#[cfg(any(unix, windows))]
pub(super) fn link_file(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(target, link);
    #[cfg(windows)]
    let result = std::os::windows::fs::symlink_file(target, link);
    check_link_creation(result, link)
}

#[cfg(any(unix, windows))]
pub(super) fn link_directory(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(target, link);
    #[cfg(windows)]
    let result = std::os::windows::fs::symlink_dir(target, link);
    check_link_creation(result, link)
}

#[cfg(any(unix, windows))]
fn check_link_creation(result: std::io::Result<()>, link: &Path) -> bool {
    match result {
        Ok(()) => true,
        Err(error)
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || (cfg!(windows) && error.raw_os_error() == Some(1314)) =>
        {
            eprintln!(
                "SKIPPED link-policy test: cannot create '{}': {error}",
                link.display()
            );
            false
        }
        Err(error) => panic!("Could not create test link '{}': {error}", link.display()),
    }
}

impl Drop for TestFiles {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
