use crate::{
    artwork::{
        collection::{Collection, DirectoryPicture, Draft, DraftPicture, Picture, Scan},
        model::ArtworkContent,
    },
    database::Database,
};
use rusqlite::params;

fn picture(color: u8, picture_type: u8) -> Picture {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 2, image::Rgb([color, 0, 0])))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    Picture {
        content: ArtworkContent {
            mime_type: "image/png".into(),
            image: bytes.into_inner(),
        },
        picture_type,
    }
}

fn database() -> Database {
    let database = Database::open(":memory:").unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "INSERT INTO tracks (id, path) VALUES (1, '/old/song.flac'), (2, '/old/other.flac');",
        )
        .unwrap();
    database
}

fn scan(embedded: Vec<Picture>, directory: Vec<(&str, Picture)>) -> Scan {
    Scan {
        embedded: Ok(embedded),
        directory: Ok(directory
            .into_iter()
            .map(|(path, picture)| DirectoryPicture {
                path: path.into(),
                content: Ok(picture.content),
            })
            .collect()),
    }
}

fn sync(database: &Database, scan: &Scan) {
    database
        .sync_artwork_collection(1, "/old/song.flac", scan)
        .unwrap();
}

fn signature(collection: &Collection) -> (Vec<(String, u8)>, Option<usize>) {
    (
        collection
            .images
            .iter()
            .map(|image| (image.content_id.clone(), image.picture.picture_type))
            .collect(),
        collection.display_index,
    )
}

fn count(database: &Database, table: &str) -> i64 {
    database
        .connection()
        .unwrap()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn collection_keeps_storage_type_and_path_identities_and_shared_content() {
    let database = database();
    let front = picture(2, 3);
    let snapshot = scan(
        vec![picture(1, 4), picture(2, 0), front.clone(), front.clone()],
        vec![
            ("/old/cover.png", front.clone()),
            ("/old/folder.png", front.clone()),
        ],
    );
    sync(&database, &snapshot);
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 5);
    assert_eq!(collection.display_index, Some(2));
    assert_eq!(
        collection.images[2].picture.content.image,
        front.content.image
    );
    assert_ne!(
        collection.images[1].artwork_id,
        collection.images[2].artwork_id
    );
    assert_eq!(
        collection.images[1].content_id,
        collection.images[2].content_id
    );
    assert_eq!(
        collection.images[2].content_id,
        collection.images[3].content_id
    );
    assert_ne!(
        collection.images[3].artwork_id,
        collection.images[4].artwork_id
    );
    let descriptions = database.describe_artwork_collections(&[1]).unwrap();
    assert_eq!(descriptions[0].pictures.len(), 5);
    assert_eq!(descriptions[0].pictures[0].source, "embedded");
    assert_eq!(descriptions[0].pictures[3].source, "directory");
    assert!(descriptions[0].pictures[3].error.is_none());
    assert_eq!(count(&database, "track_artwork_sources"), 5);
    assert_eq!(count(&database, "artwork_images"), 2);
    sync(&database, &snapshot);
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&collection)
    );
    database
        .sync_artwork_collection(2, "/old/other.flac", &snapshot)
        .unwrap();
    assert_eq!(count(&database, "artwork_images"), 2);
    assert_eq!(
        signature(&database.get_artwork_collection(2).unwrap()),
        signature(&collection)
    );
    sync(&database, &scan(vec![picture(1, 4)], vec![]));
    let remaining = database.get_artwork_collection(1).unwrap();
    assert_eq!(remaining.images.len(), 1);
    assert_eq!(remaining.display_index, Some(0));
    assert_eq!(remaining.images[0].source, "embedded");
    assert_eq!(count(&database, "artwork_images"), 2);
}

#[test]
fn scan_fallback_prefers_front_then_embedded_and_keeps_existing_display() {
    let database = database();
    sync(
        &database,
        &scan(vec![picture(1, 4)], vec![("/old/cover.png", picture(2, 3))]),
    );
    assert_eq!(
        database.get_artwork_collection(1).unwrap().display_index,
        Some(1)
    );
    sync(&database, &scan(vec![picture(1, 4), picture(3, 3)], vec![]));
    assert_eq!(
        database.get_artwork_collection(1).unwrap().display_index,
        Some(1)
    );
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    draft.pictures.remove(1);
    draft.display_index = Some(0);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    sync(&database, &scan(vec![picture(3, 3)], vec![]));
    let remaining = database.get_artwork_collection(1).unwrap();
    assert_eq!(remaining.display_index, Some(0));
    assert_eq!(remaining.images[0].picture.picture_type, 3);
}

#[test]
fn scan_tracks_confirmed_embedded_types_without_new_images_stealing_display() {
    let database = database();
    sync(&database, &scan(vec![picture(1, 4)], vec![]));
    let selected = database.get_artwork_collection(1).unwrap().images[0].artwork_id;
    sync(&database, &scan(vec![picture(1, 4), picture(2, 3)], vec![]));
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(
        collection.images[collection.display_index.unwrap()].artwork_id,
        selected
    );
    let mut draft = Draft::from(collection);
    let DraftPicture::Existing { picture_type, .. } = &mut draft.pictures[0] else {
        panic!("existing picture")
    };
    *picture_type = 18;
    draft.display_index = Some(1);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    sync(
        &database,
        &scan(vec![picture(1, 18), picture(2, 3)], vec![]),
    );
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images[0].picture.picture_type, 18);
    assert_eq!(collection.display_index, Some(1));
    sync(&database, &scan(vec![], vec![]));
    assert!(database
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
}

#[test]
fn source_failures_preserve_associations_and_confirmed_absence_preserves_manual() {
    let database = database();
    sync(
        &database,
        &scan(
            vec![picture(1, 3)],
            vec![
                ("/old/cover.png", picture(1, 3)),
                ("/old/folder.png", picture(2, 3)),
            ],
        ),
    );
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    let directory = tempfile::tempdir().unwrap();
    draft.pictures.push(DraftPicture::Linked {
        path: directory
            .path()
            .join("manual.png")
            .to_string_lossy()
            .into_owned(),
        picture: picture(3, 4),
    });
    draft.display_index = Some(3);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    let original = database.get_artwork_collection(1).unwrap();
    let partial = Scan {
        embedded: Err("audio unreadable".into()),
        directory: Err("directory unavailable".into()),
    };
    sync(&database, &partial);
    assert_eq!(
        partial.issues(),
        ["audio unreadable", "directory unavailable"]
    );
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&original)
    );
    sync(&database, &scan(vec![], vec![]));
    let remaining = database.get_artwork_collection(1).unwrap();
    assert_eq!(remaining.images.len(), 1);
    assert_eq!(
        remaining.images[0].artwork_id,
        original.images[3].artwork_id
    );
    assert_eq!(remaining.images[0].source, "manual");
    assert!(remaining.images[0].error.is_none());
    assert_eq!(remaining.display_index, Some(0));
    database
        .save_artwork_drafts(&[(1, Draft::default())])
        .unwrap();
    assert!(database
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
    assert_eq!(count(&database, "artwork_images"), 0);
    sync(
        &database,
        &scan(vec![], vec![("/old/cover.png", picture(1, 3))]),
    );
    assert_eq!(database.get_artwork_collection(1).unwrap().images.len(), 1);
}

#[test]
fn duplicate_embedded_content_and_type_are_rejected_atomically() {
    let database = database();
    sync(&database, &scan(vec![picture(1, 3)], vec![]));
    let before = database.get_artwork_collection(1).unwrap();
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    draft.pictures.push(DraftPicture::New(picture(1, 3)));
    assert!(database.save_artwork_drafts(&[(1, draft)]).is_err());
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&before)
    );
    let mut draft = Draft::from(before);
    draft.pictures.push(DraftPicture::New(picture(1, 4)));
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    assert_eq!(database.get_artwork_collection(1).unwrap().images.len(), 2);
    assert_eq!(count(&database, "artwork_images"), 1);
    database
        .save_artwork_drafts(&[(1, Draft::default())])
        .unwrap();
    assert_eq!(count(&database, "artwork_images"), 0);
    assert_eq!(count(&database, "track_artwork_sources"), 0);
}

#[test]
fn batch_drafts_are_atomic_validate_content_and_selection_and_cannot_reference_another_tracks_images(
) {
    let database = database();
    sync(&database, &scan(vec![picture(1, 3)], vec![]));
    let original = database.get_artwork_collection(1).unwrap();
    let new = Draft {
        pictures: vec![DraftPicture::New(picture(2, 4))],
        display_index: None,
    };
    assert!(database
        .save_artwork_drafts(&[(1, new.clone()), (999, Draft::default())])
        .is_err());
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&original)
    );
    assert_eq!(count(&database, "artwork_images"), 1);
    let foreign = Draft {
        pictures: vec![DraftPicture::Existing {
            artwork_id: original.images[0].artwork_id,
            picture_type: 3,
        }],
        display_index: Some(0),
    };
    assert!(database.save_artwork_drafts(&[(2, foreign)]).is_err());
    assert!(database
        .save_artwork_drafts(&[(1, new.clone()), (1, new)])
        .is_err());
    for draft in [
        Draft {
            pictures: vec![],
            display_index: Some(0),
        },
        Draft {
            pictures: vec![DraftPicture::New(Picture {
                content: ArtworkContent {
                    mime_type: "image/png".into(),
                    image: b"bad".to_vec(),
                },
                picture_type: 3,
            })],
            display_index: None,
        },
        Draft {
            pictures: vec![DraftPicture::New(Picture {
                content: ArtworkContent {
                    mime_type: "image/jpeg".into(),
                    image: picture(2, 3).content.image,
                },
                picture_type: 3,
            })],
            display_index: None,
        },
    ] {
        assert!(database.save_artwork_drafts(&[(1, draft)]).is_err());
        assert_eq!(
            signature(&database.get_artwork_collection(1).unwrap()),
            signature(&original)
        );
        assert_eq!(count(&database, "artwork_images"), 1);
    }
    assert!(database
        .sync_artwork_collection(1, "/changed/song.flac", &scan(vec![], vec![]))
        .is_err());
    assert!(database.get_artwork_collection(999).is_err());
}

#[test]
fn content_resources_include_non_display_images_and_reuse_content_cache_across_tracks() {
    let database = database();
    let snapshot = scan(vec![picture(1, 3), picture(2, 4)], vec![]);
    sync(&database, &snapshot);
    database
        .sync_artwork_collection(2, "/old/other.flac", &snapshot)
        .unwrap();
    let collection = database.get_artwork_collection(1).unwrap();
    let image = collection
        .images
        .iter()
        .find(|image| image.picture.picture_type == 4)
        .unwrap();
    assert_eq!(
        database
            .artwork_content_bytes(&image.content_id, None, |_, _| panic!(
                "original must not derive"
            ))
            .unwrap(),
        image.picture.content.image
    );
    assert_eq!(
        database
            .artwork_content_bytes(&image.content_id, Some(128), |bytes, size| {
                assert_eq!(bytes, image.picture.content.image);
                assert_eq!(size, 128);
                Ok(b"thumbnail".to_vec())
            })
            .unwrap(),
        b"thumbnail"
    );
    let shared = database.get_artwork_collection(2).unwrap();
    assert_eq!(
        database
            .artwork_content_bytes(&shared.images[1].content_id, Some(128), |_, _| panic!(
                "shared cache miss"
            ))
            .unwrap(),
        b"thumbnail"
    );
    assert!(database
        .artwork_content_bytes("missing", None, |_, _| panic!("missing content derived"))
        .unwrap()
        .is_empty());
}

#[test]
fn path_migration_updates_each_distinct_source_without_changing_content_types_or_display() {
    let database = database();
    sync(
        &database,
        &scan(
            vec![picture(1, 4)],
            vec![
                ("/old/cover.png", picture(1, 4)),
                ("/old/folder.png", picture(2, 3)),
            ],
        ),
    );
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    draft.pictures.push(DraftPicture::New(picture(3, 18)));
    draft.display_index = Some(2);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    let before = signature(&database.get_artwork_collection(1).unwrap());
    assert_eq!(database.migrate_library_paths("/old", "/new").unwrap(), 6);
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        before
    );
    let connection = database.connection().unwrap();
    let paths: Vec<String> = connection
        .prepare("SELECT source_path FROM track_artwork_sources ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        paths,
        [
            "/new/song.flac",
            "/new/cover.png",
            "/new/folder.png",
            "/new/song.flac"
        ]
    );
    let display_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM track_artwork WHERE track_id = ?1 AND is_display = 1",
            params![1],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(display_count, 1);
}

#[test]
fn linked_scans_update_all_cover_readers_and_daily_reads_keep_offline_snapshots() {
    let database = Database::open(":memory:").unwrap();
    let directory = tempfile::tempdir().unwrap();
    let audio = directory.path().join("song.flac");
    std::fs::write(&audio, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let path = directory.path().join("external.png");
    let first = picture(1, 3);
    let second = picture(2, 3);
    std::fs::write(&path, &first.content.image).unwrap();
    crate::metadata::files::write_file_with_pictures(
        &audio,
        &[],
        Some(std::slice::from_ref(&first)),
    )
    .unwrap();
    let snapshot = crate::tracks::scanning::scan(&database, &audio).unwrap();
    database.import_snapshot(&snapshot).unwrap();
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    draft.pictures.push(DraftPicture::Linked {
        path: path.to_string_lossy().into_owned(),
        picture: first.clone(),
    });
    draft.display_index = Some(1);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    let original = database.get_artwork_collection(1).unwrap();
    let id = original.images[1].artwork_id;
    assert_eq!(original.images[0].content_id, original.images[1].content_id);
    assert_ne!(original.images[0].artwork_id, id);
    let readers = |expected: &Picture| {
        assert_eq!(
            database
                .track_artwork_bytes(1, None, |_, _| unreachable!())
                .unwrap(),
            expected.content.image
        );
        assert_eq!(
            database
                .album_artwork_bytes(None, None, None, |_, _| unreachable!())
                .unwrap(),
            expected.content.image
        );
        assert_eq!(
            database
                .artwork_picture_bytes(id, None, |_, _| unreachable!())
                .unwrap(),
            expected.content.image
        );
        let crate::artwork::model::TrackArtwork::Available { data, .. } =
            database.get_track_artwork(1).unwrap().unwrap()
        else {
            panic!("media cover missing")
        };
        assert_eq!(data, expected.content.image);
        assert!(
            database.describe_artwork_collections(&[1]).unwrap()[0].pictures[1]
                .error
                .is_none()
        );
    };
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |_, _| Ok(b"old thumbnail".to_vec()))
            .unwrap(),
        b"old thumbnail"
    );
    std::fs::write(&path, &second.content.image).unwrap();
    readers(&first);
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&original)
    );
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |_, _| unreachable!())
            .unwrap(),
        b"old thumbnail"
    );
    crate::tracks::reading::reread(&database, 1).unwrap();
    readers(&second);
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |data, _| {
                assert_eq!(data, second.content.image);
                Ok(b"new thumbnail".to_vec())
            })
            .unwrap(),
        b"new thumbnail"
    );
    let current = database.get_artwork_collection(1).unwrap();
    assert_eq!(current.images[1].artwork_id, id);
    assert_ne!(current.images[1].content_id, original.images[1].content_id);
    assert_eq!(current.images[0].content_id, original.images[0].content_id);
    assert_eq!(current.images[0].picture.content.image, first.content.image);
    let editing = serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap();
    for unavailable in [None, Some(b"invalid image".as_slice())] {
        if let Some(bytes) = unavailable {
            std::fs::write(&path, bytes).unwrap();
        } else {
            std::fs::remove_file(&path).unwrap();
        }
        readers(&second);
        assert!(crate::tracks::reading::reread(&database, 1).is_err());
        assert_eq!(
            signature(&database.get_artwork_collection(1).unwrap()),
            signature(&current)
        );
        assert_eq!(
            serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap(),
            editing
        );
        assert_eq!(
            database
                .track_artwork_bytes(1, Some(128), |_, _| unreachable!())
                .unwrap(),
            b"new thumbnail"
        );
    }
    std::fs::write(&path, &first.content.image).unwrap();
    readers(&second);
    crate::tracks::reading::reread(&database, 1).unwrap();
    readers(&first);
    let restored = database.get_artwork_collection(1).unwrap();
    assert_eq!(restored.images[1].artwork_id, id);
    assert_eq!(restored.images[1].content_id, original.images[0].content_id);
    std::fs::remove_file(&audio).unwrap();
    std::fs::remove_file(&path).unwrap();
    readers(&first);
    assert!(crate::tracks::reading::reread(&database, 1).is_err());
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&restored)
    );
    let mut draft = Draft::from(restored);
    draft.pictures.remove(1);
    draft.display_index = Some(0);
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    assert_eq!(database.get_artwork_collection(1).unwrap().images.len(), 1);
}

#[test]
fn directory_discovery_and_manual_association_share_only_the_same_path_identity() {
    let database = database();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("cover.png");
    let picture = picture(1, 3);
    std::fs::write(&path, &picture.content.image).unwrap();
    let snapshot = scan(vec![], vec![(path.to_str().unwrap(), picture.clone())]);
    sync(&database, &snapshot);
    let original = database.get_artwork_collection(1).unwrap();
    let duplicate = Draft {
        pictures: vec![
            DraftPicture::Existing {
                artwork_id: original.images[0].artwork_id,
                picture_type: 3,
            },
            DraftPicture::Linked {
                path: path.canonicalize().unwrap().to_string_lossy().into_owned(),
                picture,
            },
        ],
        display_index: Some(0),
    };
    assert!(database.save_artwork_drafts(&[(1, duplicate)]).is_err());
    assert_eq!(
        database.get_artwork_collection(1).unwrap().images[0].artwork_id,
        original.images[0].artwork_id
    );
    database
        .save_artwork_drafts(&[(1, Draft::default())])
        .unwrap();
    assert!(path.exists());
    sync(&database, &snapshot);
    assert_eq!(database.get_artwork_collection(1).unwrap().images.len(), 1);
}
