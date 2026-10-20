use super::*;

#[test]
fn embed_writes_complete_per_track_sets_and_normal_tags_keep_collections() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let directory = fixture.0.join("cover.png");
    fs::write(&directory, image(90)).unwrap();
    let result = save(
        &app,
        vec![1, 2, 1],
        vec![draft(1, &[10, 20, 30]), draft(2, &[10, 40])],
        vec![change(MetadataField::Title, Some("  normalized  "))],
    )
    .unwrap();
    assert_eq!(result.len(), 2);
    for (id, colors) in [(1, vec![10, 20, 30]), (2, vec![10, 40])] {
        assert!(result[id - 1].file_written && result[id - 1].database_updated);
        let path = fixture.0.join(format!("{id}.flac"));
        let embedded = files::artwork::read_collection(&path).embedded.unwrap();
        assert_eq!(embedded.len(), colors.len());
        for color in colors {
            assert!(embedded
                .iter()
                .any(|picture| picture.content.image == image(color)));
        }
        assert_eq!(
            files::read_track_metadata(&path)
                .unwrap()
                .unwrap()
                .title
                .as_deref(),
            Some("normalized")
        );
        assert_eq!(
            app.state::<Database>()
                .get_artwork_collection(id as i64)
                .unwrap()
                .images
                .len(),
            embedded.len()
        );
    }
    assert_eq!(fs::read(&directory).unwrap(), image(90));
    let before = app.state::<Database>().get_artwork_collection(1).unwrap();
    assert!(
        save(
            &app,
            vec![1],
            vec![],
            vec![change(MetadataField::Album, Some("album"))]
        )
        .unwrap()[0]
            .database_updated
    );
    let after = app.state::<Database>().get_artwork_collection(1).unwrap();
    assert_eq!(
        before
            .images
            .iter()
            .map(|i| &i.content_id)
            .collect::<Vec<_>>(),
        after
            .images
            .iter()
            .map(|i| &i.content_id)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        files::artwork::read_collection(&fixture.0.join("1.flac"))
            .embedded
            .unwrap()
            .len(),
        3
    );
    assert!(save(&app, vec![1], vec![draft(1, &[])], vec![]).unwrap()[0].database_updated);
    assert!(files::artwork::read_collection(&fixture.0.join("1.flac"))
        .embedded
        .unwrap()
        .is_empty());
    assert!(app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
}

#[test]
fn mixed_storage_identity_writes_only_embedded_and_selection_never_writes_audio() {
    let fixture = Fixture::new();
    let app = app(&fixture, 1);
    let database = app.state::<Database>();
    let audio = fixture.0.join("1.flac");
    let first = fixture.0.join("first.png");
    let second = fixture.0.join("second.png");
    fs::write(&first, image(10)).unwrap();
    fs::write(&second, image(10)).unwrap();
    let request = || TrackDraft {
        track_id: 1,
        pictures: vec![
            PictureDraft::Embedded {
                data: image(10),
                picture_type: 3,
            },
            PictureDraft::Embedded {
                data: image(10),
                picture_type: 4,
            },
            PictureDraft::Linked {
                path: first.to_string_lossy().into_owned(),
                picture_type: 3,
            },
            PictureDraft::Linked {
                path: second.to_string_lossy().into_owned(),
                picture_type: 3,
            },
        ],
        display_index: Some(0),
    };
    let before = fs::read(&audio).unwrap();
    let prepared = editing::prepare(&database, request()).unwrap();
    assert!(prepared.requires_file_write(&audio).unwrap());
    assert_eq!(prepared.pictures.len(), 2);
    assert_eq!(fs::read(&audio).unwrap(), before);
    assert!(
        database
            .get_artwork_collection(1)
            .unwrap()
            .images
            .is_empty(),
        "cancelled preparation creates no associations"
    );
    let result = save(&app, vec![1], vec![request()], vec![]).unwrap();
    assert!(result[0].file_written && result[0].database_updated);
    let embedded = files::artwork::read_collection(&audio).embedded.unwrap();
    assert_eq!(embedded.len(), 2);
    assert_eq!(
        embedded
            .iter()
            .map(|picture| picture.picture_type)
            .collect::<Vec<_>>(),
        [3, 4]
    );
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 4);
    assert!(collection
        .images
        .iter()
        .all(|entry| entry.content_id == collection.images[0].content_id));
    let ids: std::collections::HashSet<_> = collection
        .images
        .iter()
        .map(|entry| entry.artwork_id)
        .collect();
    assert_eq!(ids.len(), 4);
    let original = fs::read(&audio).unwrap();
    let mut pictures: Vec<_> = collection
        .images
        .iter()
        .map(|entry| PictureDraft::Existing {
            artwork_id: entry.artwork_id,
            picture_type: entry.picture.picture_type,
        })
        .collect();
    pictures[2] = PictureDraft::Existing {
        artwork_id: collection.images[2].artwork_id,
        picture_type: 18,
    };
    let result = save(
        &app,
        vec![1],
        vec![TrackDraft {
            track_id: 1,
            pictures,
            display_index: Some(2),
        }],
        vec![],
    )
    .unwrap();
    assert!(!result[0].file_written && result[0].database_updated);
    assert_eq!(fs::read(&audio).unwrap(), original);
    assert_eq!(fs::read(&first).unwrap(), image(10));
    assert_eq!(fs::read(&second).unwrap(), image(10));
    let collection = database.get_artwork_collection(1).unwrap();
    let selected = collection.images[collection.display_index.unwrap()].artwork_id;
    let pictures = collection
        .images
        .iter()
        .filter(|entry| entry.artwork_id != selected)
        .map(|entry| PictureDraft::Existing {
            artwork_id: entry.artwork_id,
            picture_type: entry.picture.picture_type,
        })
        .collect();
    let result = save(
        &app,
        vec![1],
        vec![TrackDraft {
            track_id: 1,
            pictures,
            display_index: Some(0),
        }],
        vec![],
    )
    .unwrap();
    assert!(!result[0].file_written && result[0].database_updated);
    assert_eq!(
        database.get_artwork_collection(1).unwrap().display_index,
        Some(0)
    );
    assert_eq!(fs::read(&audio).unwrap(), original);
    assert_eq!(fs::read(&first).unwrap(), image(10));
}

#[test]
fn embedded_type_replacement_and_deletion_write_audio_but_repeated_save_does_not() {
    let fixture = Fixture::new();
    let app = app(&fixture, 1);
    let audio = fixture.0.join("1.flac");
    let result = save(&app, vec![1], vec![draft(1, &[10])], vec![]).unwrap();
    assert!(result[0].file_written && result[0].database_updated);
    let collection = app.state::<Database>().get_artwork_collection(1).unwrap();
    let id = collection.images[0].artwork_id;
    let request = || TrackDraft {
        track_id: 1,
        pictures: vec![PictureDraft::Existing {
            artwork_id: id,
            picture_type: 4,
        }],
        display_index: Some(0),
    };
    let result = save(&app, vec![1], vec![request()], vec![]).unwrap();
    assert!(result[0].file_written && result[0].database_updated);
    assert_eq!(
        files::artwork::read_collection(&audio).embedded.unwrap()[0].picture_type,
        4
    );
    assert_eq!(
        app.state::<Database>()
            .get_artwork_collection(1)
            .unwrap()
            .images[0]
            .picture
            .picture_type,
        4
    );
    let original = fs::read(&audio).unwrap();
    let result = save(&app, vec![1], vec![request()], vec![]).unwrap();
    assert!(!result[0].file_written && result[0].database_updated);
    assert_eq!(fs::read(&audio).unwrap(), original);
    let result = save(&app, vec![1], vec![draft(1, &[20])], vec![]).unwrap();
    assert!(result[0].file_written && result[0].database_updated);
    assert_eq!(
        files::artwork::read_collection(&audio).embedded.unwrap()[0]
            .content
            .image,
        image(20)
    );
    assert_eq!(
        app.state::<Database>()
            .get_artwork_collection(1)
            .unwrap()
            .images[0]
            .picture
            .content
            .image,
        image(20)
    );
    let result = save(&app, vec![1], vec![draft(1, &[])], vec![]).unwrap();
    assert!(result[0].file_written && result[0].database_updated);
    assert!(files::artwork::read_collection(&audio)
        .embedded
        .unwrap()
        .is_empty());
    assert!(app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
}
