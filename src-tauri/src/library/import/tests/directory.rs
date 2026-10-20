use super::super::directory::run_scan as scan_with_progress;
use crate::database::Database;
use crate::fixtures::TestFiles;
use crate::library::model::ImportResult;
use std::fs;

fn run_scan(database: &Database) -> Result<ImportResult, String> {
    scan_with_progress(database, |_, _| {})
}

#[test]
fn reports_progress_for_unique_audio_files_including_failures() {
    let files = TestFiles::new();
    fs::create_dir_all(files.0.join("nested")).unwrap();
    files.wav("song.wav");
    files.write("nested/broken.wav", b"not audio");
    files.write("notes.txt", b"not audio");
    let database = Database::open(":memory:").unwrap();
    for directory in [&files.0, &files.0.join("nested")] {
        database
            .add_music_library_directory(&fs::canonicalize(directory).unwrap().to_string_lossy())
            .unwrap();
    }
    let mut updates = Vec::new();
    let result = scan_with_progress(&database, |completed, total| {
        updates.push((completed, total));
    })
    .unwrap();
    assert_eq!(updates, vec![(0, 2), (1, 2), (2, 2)]);
    assert_eq!((result.added, result.failed), (1, 1));
}

#[test]
fn reports_empty_scan_progress() {
    let database = Database::open(":memory:").unwrap();
    let mut updates = Vec::new();
    scan_with_progress(&database, |completed, total| {
        updates.push((completed, total))
    })
    .unwrap();
    assert_eq!(updates, vec![(0, 0)]);
}

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
        let tracks = database.list_album_tracks(None, None, None).unwrap();
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
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    let original =
        serde_json::to_value(database.list_playlist_tracks(playlist_id).unwrap()).unwrap();

    let result = run_scan(&database).unwrap();

    assert_eq!(
        (result.added, result.updated, result.skipped, result.failed),
        (0, 0, 0, 0)
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
fn rescanning_counts_only_changed_metadata_and_artwork() {
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{ItemKey, Tag, TagType},
    };

    let files = TestFiles::new();
    let path = files.wav("changed.wav");
    files.wav("unchanged.wav");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    assert_eq!(run_scan(&database).unwrap().added, 2);
    assert_eq!(run_scan(&database).unwrap().updated, 0);

    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title("Changed title".into());
    tag.set_artist("Artist".into());
    tag.insert_text(ItemKey::TrackArtistSortOrder, "Sorted artist".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let result = run_scan(&database).unwrap();
    assert_eq!((result.added, result.updated, result.failed), (0, 1, 0));
    for _ in 0..5 {
        assert_eq!(run_scan(&database).unwrap().updated, 0);
    }

    tag.insert_text(ItemKey::TrackArtistSortOrder, "New sorted artist".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert_eq!(run_scan(&database).unwrap().updated, 1);
    assert_eq!(run_scan(&database).unwrap().updated, 0);

    for color in [64, 128] {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            2,
            2,
            image::Rgb([color, 0, 0]),
        ))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
        files.write("cover.png", &bytes.into_inner());
        let result = run_scan(&database).unwrap();
        assert_eq!((result.added, result.updated, result.failed), (0, 2, 0));
        assert_eq!(run_scan(&database).unwrap().updated, 0);
    }
    fs::remove_file(files.0.join("cover.png")).unwrap();
    assert_eq!(run_scan(&database).unwrap().updated, 2);
    assert_eq!(run_scan(&database).unwrap().updated, 0);
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
    // PathBuf::join normalizes `..` for canonical Windows verbatim paths.
    let root = format!(
        "{}{separator}nested{separator}..",
        files.0.display(),
        separator = std::path::MAIN_SEPARATOR
    );
    database.add_music_library_directory(&root).unwrap();

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

#[test]
fn scanning_promotes_existing_external_ids_and_only_reports_missing_library_tracks() {
    let files = TestFiles::new();
    let database = Database::open(":memory:").unwrap();
    let mut ids = Vec::new();
    for name in ["present.wav", "external.wav", "member.wav"] {
        let path = fs::canonicalize(files.wav(name)).unwrap();
        let track = crate::metadata::files::read_track(&path).unwrap().unwrap();
        let id = {
            let mut connection = database.connection().unwrap();
            let transaction = connection.transaction().unwrap();
            let id = crate::database::tracks::persist_track(
                &transaction,
                &track,
                Some(&crate::metadata::files::artwork::read_collection(&path)),
            )
            .unwrap();
            transaction.commit().unwrap();
            id
        };
        if name == "member.wav" {
            database
                .upsert_track(
                    &track,
                    Some(&crate::metadata::files::artwork::read_collection(&path)),
                )
                .unwrap();
        }
        if name != "present.wav" {
            fs::remove_file(path).unwrap();
        }
        ids.push(id);
    }
    let playlist = database.create_playlist("Favorites").unwrap();
    database
        .append_playlist_tracks(playlist, vec![ids[0]])
        .unwrap();
    let item = serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap();
    database.set_tracks_skipped(&[ids[0]], true).unwrap();
    assert!(!database.record_track_play(ids[0]).unwrap());
    database
        .add_music_library_directory(&fs::canonicalize(&files.0).unwrap().to_string_lossy())
        .unwrap();
    let member_snapshot =
        serde_json::to_value(database.get_editing_snapshot(ids[2]).unwrap()).unwrap();
    let first = run_scan(&database).unwrap();
    assert_eq!((first.added, first.updated, first.failed), (1, 0, 1));
    let second = run_scan(&database).unwrap();
    assert_eq!((second.added, second.updated, second.failed), (0, 0, 1));
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap(),
        item
    );
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![ids[0]]);
    assert!(database.list_playback_statistics().unwrap().is_empty());
    let connection = database.connection().unwrap();
    let external_issue: Option<String> = connection
        .query_row(
            "SELECT scan_issue FROM track_editing WHERE track_id = ?1",
            [ids[1]],
            |row| row.get(0),
        )
        .unwrap();
    let member_issue: Option<String> = connection
        .query_row(
            "SELECT scan_issue FROM track_editing WHERE track_id = ?1",
            [ids[2]],
            |row| row.get(0),
        )
        .unwrap();
    assert!(external_issue.is_none());
    assert!(member_issue.is_none());
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        3
    );
    drop(connection);
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(ids[2]).unwrap()).unwrap(),
        member_snapshot
    );
}
