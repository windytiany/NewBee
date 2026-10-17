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
fn imports_and_rescans_numbers_and_totals_from_combined_tags() {
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{Tag, TagType},
    };
    let files = TestFiles::new();
    let path = files.wav("numbers.wav");
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_track(1);
    tag.set_track_total(7);
    tag.set_disk(1);
    tag.set_disk_total(2);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let database = Database::open(":memory:").unwrap();
    assert_eq!(run_import(&database, std::slice::from_ref(&path)).added, 1);
    let track = serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap();
    assert_eq!(track["trackNumber"], 1);
    assert_eq!(track["trackTotal"], 7);
    assert_eq!(track["discNumber"], 1);
    assert_eq!(track["discTotal"], 2);
    tag.set_track_total(12);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert_eq!(
        run_import(&database, std::slice::from_ref(&path)).updated,
        1
    );
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["trackTotal"],
        12
    );
}

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
