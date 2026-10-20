use super::super::directory::run_scan;
use crate::fixtures::TestFiles;
use crate::{database::Database, metadata::files::access};
use std::fs;

fn cover(files: &TestFiles, color: u8) {
    image::RgbImage::from_pixel(32, 32, image::Rgb([color, 0, 0]))
        .save(files.0.join("cover.png"))
        .unwrap();
}

#[test]
fn cache_survives_reopening_and_metadata_changes_invalidate_only_one_track() {
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{Tag, TagType},
    };
    let files = TestFiles::new();
    let changed = files.wav("changed.wav");
    files.wav("unchanged.wav");
    let location = files.0.join("library.sqlite3");
    {
        let database = Database::open(&location).unwrap();
        database
            .add_music_library_directory(&files.0.to_string_lossy())
            .unwrap();
        assert_eq!(run_scan(&database, |_, _| {}).unwrap().added, 2);
    }
    access::take(&files.0);
    let database = Database::open(&location).unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 0);
    assert!(!access::take(&files.0)
        .iter()
        .any(|(_, kind)| *kind == "parse"));
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_title("Changed title".into());
    tag.save_to_path(&changed, WriteOptions::default()).unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 1);
    let parsed: Vec<_> = access::take(&files.0)
        .into_iter()
        .filter(|(_, kind)| *kind == "parse")
        .map(|(path, _)| path)
        .collect();
    assert_eq!(parsed, vec![std::path::PathBuf::from(changed)]);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 0);
}

#[test]
fn failed_database_write_rolls_back_one_track_and_is_retried() {
    let files = TestFiles::new();
    for name in ["a.wav", "b.wav", "c.wav"] {
        files.wav(name);
    }
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_middle BEFORE INSERT ON track_lyrics
         WHEN (SELECT path FROM tracks WHERE id = NEW.track_id) LIKE '%b.wav'
         BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
        )
        .unwrap();
    let result = run_scan(&database, |_, _| {}).unwrap();
    assert_eq!((result.added, result.failed), (2, 1));
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        2
    );
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_middle")
        .unwrap();
    let result = run_scan(&database, |_, _| {}).unwrap();
    assert_eq!((result.added, result.updated, result.failed), (1, 0, 0));
}

#[test]
fn manual_image_changes_and_missing_sources_are_not_hidden_by_cache() {
    use crate::artwork::track::{Draft, DraftPicture, Picture};
    let files = TestFiles::new();
    files.wav("song.wav");
    let images = TestFiles::new();
    cover(&images, 64);
    let path = images.0.join("cover.png");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().added, 1);
    database
        .save_artwork_drafts(&[(
            1,
            Draft {
                pictures: vec![DraftPicture::Linked {
                    path: path.to_string_lossy().into_owned(),
                    picture: Picture {
                        content: crate::artwork::track::linked::read(&path.to_string_lossy())
                            .unwrap(),
                        picture_type: 3,
                    },
                }],
                display_index: Some(0),
            },
        )])
        .unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().failed, 0);
    cover(&images, 128);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 1);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 0);
    fs::remove_file(&path).unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().failed, 1);
    cover(&images, 192);
    let result = run_scan(&database, |_, _| {}).unwrap();
    assert_eq!((result.updated, result.failed), (1, 0));
}

#[test]
fn database_revision_and_pending_artwork_invalidate_cached_scan() {
    let files = TestFiles::new();
    files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    run_scan(&database, |_, _| {}).unwrap();
    for sql in [
        "UPDATE tracks SET metadata_revision = metadata_revision + 1",
        "INSERT INTO track_artwork_pending (track_id) VALUES (1)",
    ] {
        access::take(&files.0);
        database.connection().unwrap().execute_batch(sql).unwrap();
        assert_eq!(run_scan(&database, |_, _| {}).unwrap().failed, 0);
        assert_eq!(
            access::take(&files.0)
                .iter()
                .filter(|(_, kind)| *kind == "parse")
                .count(),
            1
        );
    }
}

#[test]
fn corrupt_directory_artwork_preserves_previous_snapshot_and_retries() {
    let files = TestFiles::new();
    files.wav("song.wav");
    cover(&files, 64);
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    run_scan(&database, |_, _| {}).unwrap();
    let before = database.get_artwork_collection(1).unwrap().images[0]
        .picture
        .content
        .image
        .clone();
    files.write("cover.png", b"broken image");
    for _ in 0..2 {
        assert_eq!(run_scan(&database, |_, _| {}).unwrap().failed, 1);
        assert_eq!(
            database.get_artwork_collection(1).unwrap().images[0]
                .picture
                .content
                .image,
            before
        );
    }
    cover(&files, 128);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 1);
}

#[test]
fn timestamp_only_change_refreshes_cache_without_incrementing_revision() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    run_scan(&database, |_, _| {}).unwrap();
    let before: i64 = database
        .connection()
        .unwrap()
        .query_row("SELECT metadata_revision FROM tracks", [], |row| row.get(0))
        .unwrap();
    let modified =
        fs::metadata(&path).unwrap().modified().unwrap() + std::time::Duration::from_secs(2);
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    access::take(&files.0);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 0);
    assert!(access::take(&files.0)
        .iter()
        .any(|(_, kind)| *kind == "parse"));
    let after: i64 = database
        .connection()
        .unwrap()
        .query_row("SELECT metadata_revision FROM tracks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(after, before);
    run_scan(&database, |_, _| {}).unwrap();
    assert!(!access::take(&files.0)
        .iter()
        .any(|(_, kind)| *kind == "parse"));
}

#[test]
fn batch_commit_failure_does_not_publish_tracks_or_fingerprints() {
    let files = TestFiles::new();
    files.wav("first.wav");
    files.wav("second.wav");
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    database.connection().unwrap().execute_batch(
        "CREATE TABLE invalid_reference (track_id INTEGER REFERENCES tracks(id) DEFERRABLE INITIALLY DEFERRED);
         CREATE TRIGGER fail_commit AFTER INSERT ON track_lyrics BEGIN INSERT INTO invalid_reference VALUES (-1); END;"
    ).unwrap();
    assert!(run_scan(&database, |_, _| {}).is_err());
    for table in ["tracks", "track_scan"] {
        assert_eq!(
            database
                .connection()
                .unwrap()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_commit")
        .unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().added, 2);
}

#[test]
fn unchanged_scan_does_not_parse_images_or_rewrite_tracks() {
    let files = TestFiles::new();
    files.wav("first.wav");
    files.wav("second.wav");
    cover(&files, 64);
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().added, 2);
    access::take(&files.0);
    let revision = || {
        database
            .connection()
            .unwrap()
            .query_row("SELECT SUM(metadata_revision) FROM tracks", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
    };
    let before = revision();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 0);
    let accesses: Vec<_> = access::take(&files.0)
        .into_iter()
        .filter(|(_, kind)| !matches!(*kind, "directory artwork lookup" | "directory artwork read"))
        .collect();
    assert!(
        accesses.is_empty(),
        "unchanged scan performed content reads: {accesses:?}"
    );
    assert_eq!(revision(), before);
}

#[test]
fn directory_cover_is_read_once_per_scan_and_changes_are_detected() {
    let files = TestFiles::new();
    files.wav("first.wav");
    files.wav("second.wav");
    cover(&files, 64);
    let database = Database::open(":memory:").unwrap();
    database
        .add_music_library_directory(&files.0.to_string_lossy())
        .unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().added, 2);
    let reads = access::take(&files.0)
        .into_iter()
        .filter(|(_, kind)| *kind == "directory artwork read")
        .count();
    assert_eq!(reads, 1);
    cover(&files, 128);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 2);
    let reads = access::take(&files.0)
        .into_iter()
        .filter(|(_, kind)| *kind == "directory artwork read")
        .count();
    assert_eq!(reads, 1);
    fs::remove_file(files.0.join("cover.png")).unwrap();
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 2);
    assert_eq!(run_scan(&database, |_, _| {}).unwrap().updated, 0);
}
