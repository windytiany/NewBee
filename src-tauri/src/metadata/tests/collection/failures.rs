use super::*;

#[test]
fn batch_keeps_file_and_database_failures_and_continues_after_each() {
    let fixture = Fixture::new();
    let app = app(&fixture, 4);
    let path = fixture.0.join("2.flac");
    let original = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    let database = app.state::<Database>();
    let connection = database.connection().unwrap();
    connection.execute_batch("CREATE TRIGGER fail_artwork BEFORE INSERT ON track_artwork WHEN NEW.track_id=3 BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;").unwrap();
    drop(connection);
    let results = save(
        &app,
        vec![1, 2, 3, 4],
        (1..=4).map(|id| draft(id, &[10, 20])).collect(),
        vec![change(MetadataField::Title, Some("saved"))],
    )
    .unwrap();
    assert_eq!(
        results
            .iter()
            .map(|result| (
                result.track_id,
                result.file_written,
                result.database_updated
            ))
            .collect::<Vec<_>>(),
        [
            (1, true, true),
            (2, false, false),
            (3, true, false),
            (4, true, true)
        ]
    );
    assert!(results[1].error.is_some());
    assert!(results[2]
        .error
        .as_ref()
        .unwrap()
        .contains("数据库同步失败"));
    for id in [1, 3, 4] {
        assert_eq!(
            files::artwork::read_collection(&fixture.0.join(format!("{id}.flac")))
                .embedded
                .unwrap()
                .len(),
            2
        );
    }
    assert!(app
        .state::<Database>()
        .get_artwork_collection(2)
        .unwrap()
        .images
        .is_empty());
    assert_eq!(
        files::read_track_metadata(&fixture.0.join("3.flac"))
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("saved")
    );
    assert!(
        serde_json::to_value(app.state::<Database>().get_track(3).unwrap()).unwrap()["title"]
            .is_null()
    );
    assert!(app
        .state::<Database>()
        .get_artwork_collection(3)
        .unwrap()
        .images
        .is_empty());
    assert_eq!(
        app.state::<Database>()
            .get_artwork_collection(4)
            .unwrap()
            .images
            .len(),
        2
    );
    fs::write(path, original).unwrap();
}

#[test]
fn preparation_failures_are_per_track_and_request_shape_errors_precede_writes() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let original = fs::read(fixture.0.join("2.flac")).unwrap();
    let invalid = TrackDraft {
        track_id: 2,
        pictures: vec![PictureDraft::Existing {
            artwork_id: 999,
            picture_type: 3,
        }],
        display_index: Some(0),
    };
    let results = save(&app, vec![1, 2], vec![draft(1, &[10]), invalid], vec![]).unwrap();
    assert!(results[0].file_written && results[0].database_updated);
    assert!(!results[1].file_written && !results[1].database_updated && results[1].error.is_some());
    assert_eq!(fs::read(fixture.0.join("2.flac")).unwrap(), original);
    assert_eq!(
        app.state::<Database>()
            .get_artwork_collection(1)
            .unwrap()
            .images
            .len(),
        1
    );
    assert!(app
        .state::<Database>()
        .get_artwork_collection(2)
        .unwrap()
        .images
        .is_empty());
    let mut invalid = draft(1, &[10]);
    invalid.display_index = Some(1);
    let result = save(&app, vec![1], vec![invalid], vec![]).unwrap();
    assert!(!result[0].file_written && !result[0].database_updated);
    assert!(save(
        &app,
        vec![1],
        vec![draft(1, &[10]), draft(1, &[20])],
        vec![]
    )
    .is_err());
    assert!(save(&app, vec![1], vec![draft(2, &[10])], vec![]).is_err());
    for extra in [
        json!({"cover":{"action":"delete"}}),
        json!({"embedArtwork":true}),
    ] {
        let mut request = json!({"trackIds":[1],"changes":[],"lyricsAction":"keep"});
        request
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert!(serde_json::from_value::<MetadataSaveRequest>(request).is_err());
    }
}

#[test]
fn database_failure_after_audio_write_can_retry_without_writing_audio_again() {
    let fixture = Fixture::new();
    let app = app(&fixture, 1);
    let database = app.state::<Database>();
    database.connection().unwrap().execute_batch("CREATE TRIGGER fail_artwork BEFORE INSERT ON track_artwork BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;").unwrap();
    let result = save(&app, vec![1], vec![draft(1, &[10])], vec![]).unwrap();
    assert!(result[0].file_written && !result[0].database_updated && result[0].error.is_some());
    let audio = fixture.0.join("1.flac");
    let original = fs::read(&audio).unwrap();
    assert_eq!(
        files::artwork::read_collection(&audio).embedded.unwrap()[0]
            .content
            .image,
        image(10)
    );
    assert!(database
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_artwork")
        .unwrap();
    let result = save(&app, vec![1], vec![draft(1, &[10])], vec![]).unwrap();
    assert!(!result[0].file_written && result[0].database_updated && result[0].error.is_none());
    assert_eq!(fs::read(&audio).unwrap(), original);
    assert_eq!(
        database.get_artwork_collection(1).unwrap().images[0]
            .picture
            .content
            .image,
        image(10)
    );
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap(),
        serde_json::to_value(files::read_track_metadata(&audio).unwrap().unwrap().editing).unwrap()
    );
}

#[test]
fn duplicate_identity_rules_reject_only_the_failing_target() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let bad = TrackDraft {
        track_id: 1,
        pictures: vec![
            PictureDraft::Embedded {
                data: image(10),
                picture_type: 3,
            },
            PictureDraft::Embedded {
                data: image(10),
                picture_type: 3,
            },
        ],
        display_index: Some(0),
    };
    let result = save(&app, vec![1, 2], vec![bad, draft(2, &[20])], vec![]).unwrap();
    assert!(!result[0].file_written && !result[0].database_updated && result[0].error.is_some());
    assert!(result[1].file_written && result[1].database_updated);
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
    let path = fixture.0.join("first.png");
    fs::write(&path, image(10)).unwrap();
    let linked = || PictureDraft::Linked {
        path: path.to_string_lossy().into_owned(),
        picture_type: 3,
    };
    let bad = TrackDraft {
        track_id: 1,
        pictures: vec![linked(), linked()],
        display_index: Some(0),
    };
    let result = save(&app, vec![1], vec![bad], vec![]).unwrap();
    assert!(!result[0].file_written && !result[0].database_updated && result[0].error.is_some());
    assert_eq!(fs::read(path).unwrap(), image(10));
}
