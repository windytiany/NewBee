use super::*;

#[test]
fn linked_edits_and_selection_keep_audio_snapshot_revision_and_work_offline() {
    let fixture = Fixture::new();
    let app = app(&fixture, 1);
    let database = app.state::<Database>();
    let audio = fixture.0.join("1.flac");
    let original = fs::read(&audio).unwrap();
    let revision = || {
        database
            .connection()
            .unwrap()
            .query_row(
                "SELECT metadata_revision FROM tracks WHERE id=1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap()
    };
    let before_revision = revision();
    let snapshot = serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap();
    let first = fixture.0.join("first.png");
    let second = fixture.0.join("second.png");
    fs::write(&first, image(10)).unwrap();
    fs::write(&second, image(20)).unwrap();
    let request = TrackDraft {
        track_id: 1,
        pictures: vec![
            PictureDraft::Linked {
                path: first.to_string_lossy().into_owned(),
                picture_type: 3,
            },
            PictureDraft::Linked {
                path: second.to_string_lossy().into_owned(),
                picture_type: 4,
            },
        ],
        display_index: Some(0),
    };
    let result = save(&app, vec![1], vec![request], vec![]).unwrap();
    assert!(!result[0].file_written && result[0].database_updated);
    assert_eq!(fs::read(&audio).unwrap(), original);
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap(),
        snapshot
    );
    assert_eq!(revision(), before_revision);
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 2);
    fs::remove_file(&audio).unwrap();
    fs::remove_file(&first).unwrap();
    let request = TrackDraft {
        track_id: 1,
        pictures: collection
            .images
            .iter()
            .map(|item| PictureDraft::Existing {
                artwork_id: item.artwork_id,
                picture_type: 18,
            })
            .collect(),
        display_index: Some(1),
    };
    let result = save(&app, vec![1], vec![request], vec![]).unwrap();
    assert!(result[0].database_updated && !result[0].file_written);
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.display_index, Some(1));
    assert!(collection.images[0].error.is_none());
    assert_eq!(collection.images[0].picture.content.image, image(10));
    assert_eq!(
        database
            .artwork_picture_bytes(collection.images[0].artwork_id, None, |_, _| unreachable!())
            .unwrap(),
        image(10)
    );
    let offline = serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap();
    assert!(crate::tracks::reread(&database, 1).is_err());
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap(),
        offline
    );
    assert_eq!(
        database.get_artwork_collection(1).unwrap().images[0].content_id,
        collection.images[0].content_id
    );
    assert_eq!(collection.images[0].picture.picture_type, 18);
    assert_eq!(fs::read(&second).unwrap(), image(20));
    let request = TrackDraft {
        track_id: 1,
        pictures: vec![PictureDraft::Existing {
            artwork_id: collection.images[0].artwork_id,
            picture_type: 18,
        }],
        display_index: Some(0),
    };
    let result = save(&app, vec![1], vec![request], vec![]).unwrap();
    assert!(result[0].database_updated && !result[0].file_written);
    assert_eq!(fs::read(&second).unwrap(), image(20));
}

#[test]
fn unknown_linked_types_are_database_only_but_unsupported_embedded_types_fail_per_track() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let audio = fixture.0.join("1.flac");
    let original = fs::read(&audio).unwrap();
    let external = fixture.0.join("external.png");
    fs::write(&external, image(10)).unwrap();
    let request = TrackDraft {
        track_id: 1,
        pictures: vec![PictureDraft::Linked {
            path: external.to_string_lossy().into_owned(),
            picture_type: 255,
        }],
        display_index: Some(0),
    };
    let result = save(&app, vec![1], vec![request], vec![]).unwrap();
    assert!(result[0].database_updated && !result[0].file_written);
    assert_eq!(fs::read(&audio).unwrap(), original);
    assert_eq!(
        app.state::<Database>()
            .get_artwork_collection(1)
            .unwrap()
            .images[0]
            .picture
            .picture_type,
        255
    );
    let unsupported = TrackDraft {
        track_id: 1,
        pictures: vec![PictureDraft::Embedded {
            data: image(20),
            picture_type: 255,
        }],
        display_index: Some(0),
    };
    let results = save(&app, vec![1, 2], vec![unsupported, draft(2, &[30])], vec![]).unwrap();
    assert!(!results[0].file_written && !results[0].database_updated && results[0].error.is_some());
    assert!(results[1].file_written && results[1].database_updated);
    assert_eq!(fs::read(&audio).unwrap(), original);
    assert_eq!(
        app.state::<Database>()
            .get_artwork_collection(1)
            .unwrap()
            .images[0]
            .picture
            .picture_type,
        255
    );
    assert_eq!(
        files::artwork::read_collection(&fixture.0.join("2.flac"))
            .embedded
            .unwrap()[0]
            .content
            .image,
        image(30)
    );
}
