use super::super::files::run_import;
use crate::database::Database;
use crate::fixtures::TestFiles;
use std::fs;

#[test]
fn skips_duplicate_selections_and_preserves_unchanged_tracks_and_ids() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    let result = run_import(&database, &[path.clone(), path.clone()]);
    assert_eq!((result.added, result.skipped), (1, 1));
    let playlist = database.create_playlist("playlist").unwrap();
    database.append_playlist_tracks(playlist, vec![1]).unwrap();
    let result = run_import(&database, &[path]);
    assert_eq!((result.added, result.updated), (0, 0));
    assert!(database.get_track(1).unwrap().is_some());
    assert!(database.get_track(2).unwrap().is_none());
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap()[0]
            ["trackId"],
        1
    );
}

#[test]
fn continues_after_unsupported_missing_corrupt_and_directory_inputs() {
    let files = TestFiles::new();
    let unsupported = files.write("notes.txt", b"not audio");
    let corrupt = files.write("corrupt.mp3", b"not audio");
    let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
    let directory = files.0.join("folder.wav");
    fs::create_dir(&directory).unwrap();
    let valid = files.wav("valid.wav");
    let database = Database::open(":memory:").unwrap();
    let result = run_import(
        &database,
        &[
            unsupported,
            corrupt,
            missing,
            directory.to_string_lossy().into_owned(),
            valid,
        ],
    );
    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (1, 0, 1, 3)
    );
}

#[test]
fn canonicalizes_selected_paths_and_deduplicates_aliases() {
    let files = TestFiles::new();
    let target = files.wav("song.wav");
    fs::create_dir(files.0.join("nested")).unwrap();
    let alias = files
        .0
        .join("nested/../song.wav")
        .to_string_lossy()
        .into_owned();
    let database = Database::open(":memory:").unwrap();

    let result = run_import(&database, &[alias, target.clone()]);

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (1, 0, 1, 0)
    );
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        fs::canonicalize(target).unwrap().to_string_lossy()
    );
}
