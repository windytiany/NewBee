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
fn collection_merges_content_keeps_every_source_and_prefers_front_embedded_then_stable_order() {
    let database = database();
    let back = picture(1, 4);
    let front = picture(2, 3);
    let folder = picture(3, 3);
    let mut duplicate = front.clone();
    duplicate.picture_type = 0;
    let snapshot = scan(
        vec![back.clone(), duplicate, front.clone()],
        vec![
            ("/old/cover.png", front.clone()),
            ("/old/folder.png", folder),
        ],
    );
    sync(&database, &snapshot);
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 3);
    assert_eq!(
        collection.images[collection.display_index.unwrap()]
            .picture
            .content
            .image,
        front.content.image
    );
    let descriptions = database.describe_artwork_collections(&[1]).unwrap();
    let described = &descriptions[0];
    assert_eq!(described.pictures.len(), 3);
    assert!(described.pictures[0].embedded);
    assert!(
        described.pictures[1].embedded,
        "merged content retains embedded priority"
    );
    assert!(!described.pictures[2].embedded);
    let json = serde_json::to_value(described).unwrap();
    assert_eq!(json["pictures"][0]["embedded"], true);
    assert_eq!(json["pictures"][2]["embedded"], false);
    assert_eq!(count(&database, "track_artwork_sources"), 4);
    assert_eq!(count(&database, "artwork_images"), 3);
    sync(&database, &snapshot);
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&collection)
    );
    database
        .sync_artwork_collection(2, "/old/other.flac", &snapshot)
        .unwrap();
    assert_eq!(count(&database, "artwork_images"), 3);
    assert_eq!(
        signature(&database.get_artwork_collection(2).unwrap()),
        signature(&collection)
    );

    sync(&database, &scan(vec![back.clone()], vec![]));
    let remaining = database.get_artwork_collection(1).unwrap();
    assert_eq!(remaining.display_index, Some(0));
    assert_eq!(
        remaining.images[0].picture.content.image,
        back.content.image
    );
    assert_eq!(
        count(&database, "artwork_images"),
        3,
        "the other track still references all content"
    );
}

#[test]
fn fallback_ranks_front_before_embedded_and_embedded_before_stable_manual_order() {
    let database = database();
    let embedded = picture(1, 4);
    let directory = picture(2, 3);
    sync(
        &database,
        &scan(
            vec![embedded.clone()],
            vec![("/old/cover.png", directory.clone())],
        ),
    );
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(
        collection.images[collection.display_index.unwrap()]
            .picture
            .content
            .image,
        directory.content.image
    );
    let mut draft = Draft::from(collection);
    draft.pictures.push(DraftPicture::New(picture(3, 4)));
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    sync(&database, &scan(vec![embedded.clone()], vec![]));
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(
        collection.images[collection.display_index.unwrap()]
            .picture
            .content
            .image,
        embedded.content.image
    );
    sync(&database, &scan(vec![], vec![]));
    assert_eq!(
        database.get_artwork_collection(1).unwrap().display_index,
        Some(0)
    );
}

#[test]
fn scan_preserves_overridden_type_valid_display_and_manual_images_without_new_images_stealing_display(
) {
    let database = database();
    let original = picture(1, 4);
    sync(&database, &scan(vec![original.clone()], vec![]));
    let before = database.get_artwork_collection(1).unwrap();
    let selected_id = before.images[0].content_id.clone();
    sync(
        &database,
        &scan(vec![original.clone(), picture(2, 3)], vec![]),
    );
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(
        collection.images[collection.display_index.unwrap()].content_id,
        selected_id
    );
    let mut draft = Draft::from(collection);
    let DraftPicture::Existing { picture_type, .. } = &mut draft.pictures[0] else {
        panic!("existing picture")
    };
    *picture_type = 18;
    draft.display_index = Some(1);
    draft.pictures.push(DraftPicture::New(picture(3, 8)));
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    let expected = signature(&database.get_artwork_collection(1).unwrap());
    let mut changed = original;
    changed.picture_type = 3;
    sync(&database, &scan(vec![changed, picture(2, 4)], vec![]));
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images[0].picture.picture_type, 18);
    assert_eq!(collection.display_index, expected.1);
    assert_eq!(collection.images.len(), 3);
    sync(&database, &scan(vec![], vec![]));
    let manual = database.get_artwork_collection(1).unwrap();
    assert_eq!(manual.images.len(), 1);
    assert_eq!(manual.images[0].picture.picture_type, 8);
    assert_eq!(manual.display_index, Some(0));
}

#[test]
fn independent_source_failures_preserve_snapshots_but_confirmed_absence_and_replacement_remove_only_that_source(
) {
    let database = database();
    let shared = picture(1, 3);
    sync(
        &database,
        &scan(
            vec![shared.clone()],
            vec![
                ("/old/cover.png", shared),
                ("/old/folder.jpg", picture(2, 3)),
                ("/old/folder.png", picture(3, 3)),
            ],
        ),
    );
    let original = database.get_artwork_collection(1).unwrap();
    let partial = Scan {
        embedded: Err("audio unreadable".into()),
        directory: Ok(vec![
            DirectoryPicture {
                path: "/old/folder.jpg".into(),
                content: Err("image unreadable".into()),
            },
            DirectoryPicture {
                path: "/old/folder.png".into(),
                content: Ok(picture(4, 3).content),
            },
            DirectoryPicture {
                path: "/old/cover.jpg".into(),
                content: Ok(picture(5, 3).content),
            },
        ]),
    };
    sync(&database, &partial);
    assert_eq!(partial.issues(), ["audio unreadable", "image unreadable"]);
    let after = database.get_artwork_collection(1).unwrap();
    assert_eq!(after.images.len(), 4);
    assert_eq!(
        after.images[after.display_index.unwrap()].content_id,
        original.images[original.display_index.unwrap()].content_id
    );
    assert!(after
        .images
        .iter()
        .any(|image| image.content_id == original.images[1].content_id));
    assert!(!after
        .images
        .iter()
        .any(|image| image.content_id == original.images[2].content_id));
    assert_eq!(count(&database, "track_artwork_sources"), 4);
    sync(
        &database,
        &Scan {
            embedded: Ok(vec![]),
            directory: Err("directory unavailable".into()),
        },
    );
    assert_eq!(database.get_artwork_collection(1).unwrap().images.len(), 3);
    sync(&database, &scan(vec![], vec![]));
    assert!(database
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
    assert_eq!(
        database.get_artwork_collection(1).unwrap().display_index,
        None
    );
    assert_eq!(count(&database, "artwork_images"), 0);
}

#[test]
fn manually_adding_existing_bytes_merges_content_and_keeps_it_after_all_file_sources_disappear() {
    let database = database();
    let picture = picture(1, 3);
    sync(&database, &scan(vec![picture.clone()], vec![]));
    let before = database.get_artwork_collection(1).unwrap();
    let mut draft = Draft::from(database.get_artwork_collection(1).unwrap());
    draft.pictures.push(DraftPicture::New(picture.clone()));
    draft.pictures.push(DraftPicture::New(picture));
    database.save_artwork_drafts(&[(1, draft)]).unwrap();
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&before)
    );
    assert_eq!(count(&database, "track_artwork_sources"), 2);
    sync(&database, &scan(vec![], vec![]));
    assert_eq!(
        signature(&database.get_artwork_collection(1).unwrap()),
        signature(&before)
    );
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
            content_id: original.images[0].content_id.clone(),
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
    assert_eq!(database.migrate_library_paths("/old", "/new").unwrap(), 5);
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
        ["/new/song.flac", "/new/cover.png", "/new/folder.png", ""]
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
