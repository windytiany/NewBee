use super::readable_files;
use crate::library::import::tests::support::TestFiles;

#[test]
fn ignores_folders_unsupported_missing_and_unreadable_files_without_losing_valid_files() {
    let files = TestFiles::new();
    let first = files.wav("first.WAV");
    let last = files.wav("last.wav");
    let unsupported = files.wav("unsupported.opus");
    let broken = files.write("broken.mp3", b"not audio");
    let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
    let directory = files.0.join("folder.wav");
    std::fs::create_dir(&directory).unwrap();
    files.wav("folder.wav/nested.wav");
    assert_eq!(
        readable_files(vec![
            first.clone(),
            unsupported,
            broken,
            missing,
            directory.to_string_lossy().into_owned(),
            last.clone(),
        ]),
        vec![first, last]
    );
}
