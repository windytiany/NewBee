use std::path::Path;

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
