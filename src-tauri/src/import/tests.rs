use super::readable_files;
use crate::library::import::tests::support::TestFiles;
use std::path::Path;

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
