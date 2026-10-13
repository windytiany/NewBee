use super::{has_supported_extension, supported_audio_extensions};
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
