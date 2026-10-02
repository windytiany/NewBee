use super::super::directory::run_scan;
use super::support::TestFiles;
use crate::database::Database;
use std::fs;

#[test]
fn scans_nested_and_overlapping_directories_once_in_either_order() {
    let files = TestFiles::new();
    fs::create_dir_all(files.0.join("nested/deeper")).unwrap();
    files.wav("first.wav");
    files.wav("nested/deeper/日本語.WAV");
    files.write("notes.txt", b"not audio");
    let root = fs::canonicalize(&files.0).unwrap();
    let nested = fs::canonicalize(files.0.join("nested")).unwrap();

    for directories in [[&root, &nested], [&nested, &root]] {
        let database = Database::open(":memory:").unwrap();
        for directory in directories {
            database
                .add_music_library_directory(&directory.to_string_lossy())
                .unwrap();
        }
        let result = run_scan(&database).unwrap();
        assert_eq!(
            (result.added, result.updated, result.skipped, result.failed),
            (2, 0, 1, 0)
        );
        let tracks = database.list_album_tracks(None, None).unwrap();
        assert_eq!(tracks.len(), 2);
        assert!(database.get_track(3).unwrap().is_none());
    }
}

#[test]
fn rescanning_preserves_track_ids_and_playlist_items() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&fs::canonicalize(&files.0).unwrap().to_string_lossy())
        .unwrap();
    assert_eq!(run_scan(&database).unwrap().added, 1);
    let playlist_id = database.create_playlist("Favorites").unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    let original =
        serde_json::to_value(database.list_playlist_tracks(playlist_id).unwrap()).unwrap();

    let result = run_scan(&database).unwrap();

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (0, 1, 0, 0)
    );
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        fs::canonicalize(path).unwrap().to_string_lossy()
    );
    assert!(database.get_track(2).unwrap().is_none());
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist_id).unwrap()).unwrap(),
        original
    );
}

#[test]
fn continues_after_missing_roots_non_directory_roots_and_corrupt_files() {
    let files = TestFiles::new();
    let directory = files.0.join("removed");
    fs::create_dir(&directory).unwrap();
    let removed = fs::canonicalize(&directory).unwrap();
    fs::remove_dir(directory).unwrap();
    let corrupt = files.write("corrupt.mp3", b"not audio");
    files.write("notes.txt", b"not audio");
    files.wav("valid.wav");
    let database = Database::open(":memory:").unwrap();
    for path in [
        removed,
        fs::canonicalize(corrupt).unwrap(),
        fs::canonicalize(&files.0).unwrap(),
    ] {
        database
            .add_music_library_directory(&path.to_string_lossy())
            .unwrap();
    }

    let result = run_scan(&database).unwrap();

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (1, 0, 1, 3)
    );
    assert!(database.get_track(1).unwrap().is_some());
}

#[test]
fn rejects_roots_that_no_longer_match_the_saved_canonical_path() {
    let files = TestFiles::new();
    fs::create_dir(files.0.join("nested")).unwrap();
    files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.join("nested/..").to_string_lossy())
        .unwrap();

    let result = run_scan(&database).unwrap();

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (0, 0, 0, 1)
    );
    assert!(database.get_track(1).unwrap().is_none());
}

#[test]
fn empty_configuration_does_not_change_the_library() {
    let database = Database::open(":memory:").unwrap();
    let result = run_scan(&database).unwrap();
    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (0, 0, 0, 0)
    );
    assert!(database.get_track(1).unwrap().is_none());
}

#[cfg(any(unix, windows))]
#[test]
fn skips_file_and_directory_links_without_importing_their_targets() {
    use super::support::{link_directory, link_file};
    let files = TestFiles::new();
    let targets = TestFiles::new();
    let target = targets.wav("outside.wav");
    files.wav("inside.wav");
    if !link_file(std::path::Path::new(&target), &files.0.join("linked.wav"))
        || !link_directory(&targets.0, &files.0.join("linked-directory"))
    {
        return;
    }
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&fs::canonicalize(&files.0).unwrap().to_string_lossy())
        .unwrap();

    let result = run_scan(&database).unwrap();

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (1, 0, 2, 0)
    );
    assert!(database.get_track(2).unwrap().is_none());
}

#[cfg(any(unix, windows))]
#[test]
fn rejects_a_saved_root_replaced_by_a_link_and_continues_other_roots() {
    use super::support::link_directory;
    let files = TestFiles::new();
    fs::create_dir(files.0.join("saved")).unwrap();
    fs::create_dir(files.0.join("valid")).unwrap();
    files.wav("saved/rejected.wav");
    files.wav("valid/imported.wav");
    let saved = fs::canonicalize(files.0.join("saved")).unwrap();
    let moved = files.0.join("moved");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&saved.to_string_lossy())
        .unwrap();
    database
        .add_music_library_directory(
            &fs::canonicalize(files.0.join("valid"))
                .unwrap()
                .to_string_lossy(),
        )
        .unwrap();
    fs::rename(&saved, &moved).unwrap();
    if !link_directory(&moved, &saved) {
        return;
    }

    let result = run_scan(&database).unwrap();

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (1, 0, 0, 1)
    );
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        fs::canonicalize(files.0.join("valid/imported.wav"))
            .unwrap()
            .to_string_lossy()
    );
    assert!(database.get_track(2).unwrap().is_none());
}
