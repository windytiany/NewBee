mod directory;
mod files;
mod support;

use super::{has_supported_extension, supported_audio_extensions, IngestState};
use std::path::Path;

#[test]
fn exposes_the_same_extensions_used_for_backend_validation() {
    for extension in supported_audio_extensions() {
        assert!(has_supported_extension(Path::new(&format!(
            "song.{extension}"
        ))));
        assert!(has_supported_extension(Path::new(&format!(
            "song.{}",
            extension.to_ascii_uppercase()
        ))));
    }
    assert!(!has_supported_extension(Path::new("song.opus")));
    assert!(!has_supported_extension(Path::new("song")));
}

#[test]
fn scan_and_import_share_an_exclusive_guard_that_releases_on_drop() {
    let state = IngestState::default();
    let guard = state.acquire().unwrap();
    assert!(state.acquire().is_err());
    drop(guard);
    assert!(state.acquire().is_ok());
}
