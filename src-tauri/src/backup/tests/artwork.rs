use super::{manifest, Directory};
use crate::{
    artwork::encoding,
    backup::{apply_pending_restore, archive, restore},
    database::{ArtworkContent, Database},
    metadata::model::LyricsMarkAction,
};
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use rusqlite::Connection;
use std::{fs, io::Cursor, path::Path};

fn original(color: [u8; 4]) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(256, 256, Rgba(color)))
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn library(root: &Path, cache: &Path, image: &[u8]) -> Database {
    let database = Database::open_with_cache(root.join("music-library.sqlite3"), cache).unwrap();
    let connection = Connection::open(root.join("music-library.sqlite3")).unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path) VALUES ('/offline/missing.mp3')",
            [],
        )
        .unwrap();
    database
        .update_metadata_cover_and_lyrics(
            1,
            &[],
            Some(&ArtworkContent {
                mime_type: "image/png".into(),
                image: image.to_vec(),
            }),
            LyricsMarkAction::Keep,
            None,
        )
        .unwrap();
    database
}

fn thumbnail(database: &Database) -> Vec<u8> {
    database
        .track_artwork_bytes(1, Some(128), |data, size| encoding::thumbnail(&data, size))
        .unwrap()
}

#[test]
fn backup_contains_originals_not_cache_and_restores_offline_into_an_empty_cache() {
    let source = Directory::new();
    let target = Directory::new();
    let caches = tempfile::tempdir().unwrap();
    let original = original([255, 0, 0, 255]);
    let database = library(&source.0, &caches.path().join("source"), &original);
    let expected = thumbnail(&database);
    assert_eq!(
        fs::read_dir(caches.path().join("source")).unwrap().count(),
        1
    );
    let file = source.0.join("backup.newbee");
    archive::write(&database, &manifest(), &file).unwrap();
    let backup = Connection::open(&file).unwrap();
    assert_eq!(
        backup
            .query_row("SELECT image FROM artwork_images", [], |row| row
                .get::<_, Vec<u8>>(0))
            .unwrap(),
        original
    );
    assert!(backup.prepare("SELECT * FROM artwork_thumbnails").is_err());
    assert_eq!(
        backup
            .query_row("SELECT COUNT(*) FROM artwork_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(backup);
    drop(database);
    fs::remove_dir_all(caches.path().join("source")).unwrap();
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&target.0).unwrap());
    let cache = caches.path().join("target");
    let restored =
        Database::open_with_cache(target.0.join("music-library.sqlite3"), &cache).unwrap();
    assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
    assert_eq!(
        restored
            .track_artwork_bytes(1, None, |_, _| panic!("original derived"))
            .unwrap(),
        original
    );
    assert_eq!(thumbnail(&restored), expected);
    assert_eq!(fs::read_dir(&cache).unwrap().count(), 1);
    assert_eq!(
        restored
            .track_artwork_bytes(1, Some(128), |_, _| panic!("cache miss after rebuild"))
            .unwrap(),
        expected
    );
    assert!(!target.0.join("offline").exists());
}

#[test]
fn restoring_reused_database_ids_never_returns_previous_library_cache() {
    let source = Directory::new();
    let target = Directory::new();
    let caches = tempfile::tempdir().unwrap();
    let cache = caches.path().join("target");
    let red = original([255, 0, 0, 255]);
    let source_database = library(&source.0, &caches.path().join("source"), &red);
    let expected = thumbnail(&source_database);
    let file = source.0.join("backup.newbee");
    archive::write(&source_database, &manifest(), &file).unwrap();
    let previous = library(&target.0, &cache, &original([0, 0, 255, 255]));
    // Force an adversarial digest collision across two libraries with reused IDs.
    let digest: Vec<u8> = Connection::open(source.0.join("music-library.sqlite3"))
        .unwrap()
        .query_row("SELECT digest FROM artwork_images", [], |row| row.get(0))
        .unwrap();
    Connection::open(target.0.join("music-library.sqlite3"))
        .unwrap()
        .execute("UPDATE artwork_images SET digest = ?1", [digest])
        .unwrap();
    let stale = thumbnail(&previous);
    assert_ne!(stale, expected);
    // Both libraries use image_id = 1 and the same digest, but distinct content identities.
    for root in [&source.0, &target.0] {
        let connection = Connection::open(root.join("music-library.sqlite3")).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT image_id FROM track_artwork", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    drop(previous);
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&target.0).unwrap());
    let restored =
        Database::open_with_cache(target.0.join("music-library.sqlite3"), &cache).unwrap();
    assert_eq!(
        fs::read_dir(&cache).unwrap().count(),
        0,
        "orphan cache survived restore"
    );
    assert_eq!(thumbnail(&restored), expected);
    assert_eq!(
        restored
            .track_artwork_bytes(1, None, |_, _| panic!("original derived"))
            .unwrap(),
        red
    );
}
