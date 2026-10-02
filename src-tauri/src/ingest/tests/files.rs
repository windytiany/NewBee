use super::super::files::run_import;
use super::support::TestFiles;
use crate::database::Database;
use std::fs;
use std::path::Path;

#[test]
fn imports_multiple_files_and_preserves_original_locations() {
    let files = TestFiles::new();
    let first = files.wav("中文.wav");
    let second = files.wav("日本語.WAV");
    let database = Database::open(":memory:").unwrap();
    let result = run_import(&database, &[first.clone(), second.clone()]);
    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (2, 0, 0, 0)
    );
    for (id, path) in [(1, first), (2, second)] {
        let track = database.get_track(id).unwrap().unwrap();
        assert_eq!(
            track.path(),
            fs::canonicalize(&path).unwrap().to_string_lossy()
        );
        assert!(Path::new(&path).is_file());
        let metadata = serde_json::to_value(track).unwrap();
        assert_eq!(metadata["sampleRateHz"], 8000);
        assert_eq!(metadata["channels"], 1);
        assert_eq!(metadata["durationMs"], 1000);
    }
    assert!(database
        .list_music_library_directories()
        .unwrap()
        .is_empty());
}

#[test]
fn skips_duplicate_selections_and_updates_existing_tracks_without_changing_ids() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    let result = run_import(&database, &[path.clone(), path.clone()]);
    assert_eq!((result.added, result.skipped), (1, 1));
    let playlist = database.create_playlist("playlist").unwrap();
    database.add_track_to_playlist(playlist, 1).unwrap();
    let result = run_import(&database, &[path]);
    assert_eq!((result.added, result.updated), (0, 1));
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
fn empty_selection_does_not_change_the_library() {
    let database = Database::open(":memory:").unwrap();
    let result = run_import(&database, &[]);
    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (0, 0, 0, 0)
    );
    assert!(database.get_track(1).unwrap().is_none());
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

#[cfg(any(unix, windows))]
#[test]
fn follows_selected_file_links_and_deduplicates_the_target() {
    use super::support::link_file;
    let files = TestFiles::new();
    let target = files.wav("song.wav");
    let link = files.0.join("selected.wav");
    if !link_file(Path::new(&target), &link) {
        return;
    }
    let database = Database::open(":memory:").unwrap();

    let result = run_import(
        &database,
        &[link.to_string_lossy().into_owned(), target.clone()],
    );

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (1, 0, 1, 0)
    );
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        fs::canonicalize(target).unwrap().to_string_lossy()
    );
}
