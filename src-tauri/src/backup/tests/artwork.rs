use super::{manifest, Directory};
use crate::{
    artwork::{encoding, model::ArtworkContent},
    backup::{apply_pending_restore, archive, restore},
    database::Database,
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
            Some(Some(&ArtworkContent {
                mime_type: "image/png".into(),
                image: image.to_vec(),
            })),
            None,
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

#[test]
fn backup_round_trip_preserves_collection_sources_types_and_display_selection() {
    use crate::artwork::collection::{DirectoryPicture, Draft, DraftPicture, Picture, Scan};
    let source = Directory::new();
    let target = Directory::new();
    let caches = tempfile::tempdir().unwrap();
    let red = original([255, 0, 0, 255]);
    let blue = original([0, 0, 255, 255]);
    let green = original([0, 255, 0, 255]);
    let content = |image: Vec<u8>| ArtworkContent {
        mime_type: "image/png".into(),
        image,
    };
    let database = library(&source.0, &caches.path().join("source"), &red);
    database
        .sync_artwork_collection(
            1,
            "/offline/missing.mp3",
            &Scan {
                embedded: Ok(vec![Picture {
                    content: content(red.clone()),
                    picture_type: 3,
                }]),
                directory: Ok(vec![
                    DirectoryPicture {
                        path: "/offline/cover.png".into(),
                        content: Ok(content(red)),
                    },
                    DirectoryPicture {
                        path: "/offline/folder.png".into(),
                        content: Ok(content(blue)),
                    },
                ]),
            },
        )
        .unwrap();
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    let DraftPicture::Existing { picture_type, .. } = &mut draft.pictures[0] else {
        panic!("existing picture")
    };
    *picture_type = 18;
    draft.pictures.push(DraftPicture::New(Picture {
        content: content(green.clone()),
        picture_type: 4,
    }));
    draft.display_index = Some(3);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    let before = database.get_artwork_collection(1).unwrap();
    let file = source.0.join("collection.newbee");
    archive::write(&database, &manifest(), &file).unwrap();
    let backup = Connection::open(&file).unwrap();
    let sources: i64 = backup
        .query_row("SELECT COUNT(*) FROM track_artwork_sources", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(sources, 4);
    drop(backup);
    drop(database);
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&target.0).unwrap());
    let restored = Database::open_with_cache(
        target.0.join("music-library.sqlite3"),
        &caches.path().join("target"),
    )
    .unwrap();
    let after = restored.get_artwork_collection(1).unwrap();
    assert_eq!(after.display_index, before.display_index);
    assert_eq!(after.images.len(), 4);
    for (actual, expected) in after.images.iter().zip(&before.images) {
        assert_eq!(actual.artwork_id, expected.artwork_id);
        assert_eq!(actual.source, expected.source);
        assert_eq!(actual.path, expected.path);
        assert_eq!(actual.error.is_some(), expected.error.is_some());
        assert_eq!(actual.content_id, expected.content_id);
        assert_eq!(actual.picture.picture_type, expected.picture.picture_type);
        assert_eq!(actual.picture.content.image, expected.picture.content.image);
    }
    assert_eq!(
        restored
            .track_artwork_bytes(1, None, |_, _| panic!("original derived"))
            .unwrap(),
        green
    );
    restored
        .sync_artwork_collection(
            1,
            "/offline/missing.mp3",
            &Scan {
                embedded: Ok(vec![]),
                directory: Ok(vec![]),
            },
        )
        .unwrap();
    let remaining = restored.get_artwork_collection(1).unwrap();
    assert!(
        remaining.images.is_empty(),
        "confirmed absence removes scanned artwork"
    );
    assert!(restored
        .track_artwork_bytes(1, None, |_, _| panic!("unavailable association derived"))
        .unwrap()
        .is_empty());
}
