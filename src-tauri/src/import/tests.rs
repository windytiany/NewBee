use super::{preview_paths, readable_files};
use crate::library::import::tests::support::TestFiles;
use std::path::Path;

#[test]
fn previews_directories_without_searching_for_audio_or_reading_tags() {
    let files = TestFiles::new();
    let empty = files.0.join("empty");
    std::fs::create_dir(&empty).unwrap();
    let preview = preview_paths(vec![empty.to_string_lossy().into_owned()]);
    assert!(preview.has_directories);
    assert!(!preview.has_files);

    let broken = files.write("broken.mp3", b"not audio");
    let unsupported = files.wav("unsupported.opus");
    let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
    let preview = preview_paths(vec![broken, unsupported.clone(), missing.clone()]);
    assert!(preview.has_files);
    assert!(!preview.has_directories);
    let preview = preview_paths(vec![unsupported, missing]);
    assert!(!preview.has_files);
    assert!(!preview.has_directories);
}

#[test]
fn discovers_accessible_files_and_directories_without_requiring_readable_tags() {
    let files = TestFiles::new();
    let first = files.wav("first.WAV");
    let last = files.wav("last.wav");
    let unsupported = files.wav("unsupported.opus");
    let broken = files.write("broken.mp3", b"not audio");
    let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
    let directory = files.0.join("folder.wav");
    std::fs::create_dir(&directory).unwrap();
    let nested = files.wav("folder.wav/nested.wav");
    let expected: Vec<_> = [&first, &broken, &nested, &last]
        .into_iter()
        .map(|path| {
            Path::new(path)
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(
        readable_files(vec![
            first,
            unsupported,
            broken,
            missing,
            directory.to_string_lossy().into_owned(),
            last,
        ]),
        expected
    );
}
