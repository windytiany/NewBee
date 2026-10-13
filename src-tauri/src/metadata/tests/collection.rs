use super::support::{change, Fixture};
use crate::{
    artwork::{
        collection::{
            commands,
            editing::{self, PictureDraft, TrackDraft},
        },
        model::ArtworkContent,
    },
    database::Database,
    locking::write::WriteState,
    metadata::{
        files,
        model::{LyricsMarkAction, MetadataField, MetadataSaveRequest},
        save_track_metadata,
    },
};
use serde_json::json;
use std::fs;
use tauri::Manager;

fn image(color: u8) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(3, 2, image::Rgb([color, 0, 0])))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn app(fixture: &Fixture, count: usize) -> tauri::App<tauri::test::MockRuntime> {
    let database = Database::open(":memory:").unwrap();
    for index in 1..=count {
        let path = fixture.0.join(format!("{index}.flac"));
        fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
        database
            .upsert_track(&files::read_track_metadata(&path).unwrap().unwrap(), None)
            .unwrap();
    }
    tauri::test::mock_builder()
        .manage(database)
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_track_artwork_collections,
            commands::get_artwork_content
        ])
        .build(tauri::generate_context!())
        .unwrap()
}

fn draft(id: i64, colors: &[u8]) -> TrackDraft {
    TrackDraft {
        track_id: id,
        pictures: colors
            .iter()
            .enumerate()
            .map(|(index, color)| PictureDraft::New {
                data: image(*color),
                picture_type: if index == 0 { 3 } else { 4 },
            })
            .collect(),
        display_index: (!colors.is_empty()).then_some(0),
    }
}

fn save(
    app: &tauri::App<tauri::test::MockRuntime>,
    ids: Vec<i64>,
    drafts: Vec<TrackDraft>,
    embed: bool,
    changes: Vec<crate::metadata::model::MetadataChange>,
) -> Result<Vec<super::super::MetadataSaveResult>, String> {
    tauri::async_runtime::block_on(save_track_metadata(
        MetadataSaveRequest {
            track_ids: ids,
            changes,
            lyrics_action: LyricsMarkAction::Keep,
            artwork_drafts: drafts,
            embed_artwork: embed,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
}

#[test]
fn database_only_keeps_file_snapshot_revision_and_offline_edits_work() {
    let fixture = Fixture::new();
    let app = app(&fixture, 1);
    let database = app.state::<Database>();
    let path = fixture.0.join("1.flac");
    let original = fs::read(&path).unwrap();
    let revision: i64 = database
        .connection()
        .unwrap()
        .query_row(
            "SELECT metadata_revision FROM tracks WHERE id=1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let snapshot = serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap();
    let result = save(&app, vec![1], vec![draft(1, &[10, 20])], false, vec![]).unwrap();
    assert!(!result[0].file_written && result[0].database_updated);
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(1).unwrap()).unwrap(),
        snapshot
    );
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row(
                "SELECT metadata_revision FROM tracks WHERE id=1",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        revision
    );
    let collection = database.get_artwork_collection(1).unwrap();
    assert_eq!(collection.images.len(), 2);
    fs::remove_file(&path).unwrap();
    let draft = TrackDraft {
        track_id: 1,
        pictures: collection
            .images
            .iter()
            .map(|item| PictureDraft::Existing {
                content_id: item.content_id.clone(),
                picture_type: 4,
            })
            .collect(),
        display_index: Some(1),
    };
    assert!(save(&app, vec![1], vec![draft], false, vec![]).unwrap()[0].database_updated);
    assert_eq!(
        database.get_artwork_collection(1).unwrap().display_index,
        Some(1)
    );
}

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
        true,
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
            false,
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
    assert!(save(&app, vec![1], vec![draft(1, &[])], true, vec![]).unwrap()[0].database_updated);
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
        true,
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
fn unknown_picture_types_remain_editable_without_embedding() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let database = app.state::<Database>();
    let original = fs::read(fixture.0.join("1.flac")).unwrap();
    database
        .save_artwork_drafts(&[(
            1,
            crate::artwork::collection::Draft {
                pictures: vec![crate::artwork::collection::DraftPicture::New(
                    crate::artwork::collection::Picture {
                        content: ArtworkContent {
                            mime_type: "image/png".into(),
                            image: image(10),
                        },
                        picture_type: 255,
                    },
                )],
                display_index: Some(0),
            },
        )])
        .unwrap();
    let collection = database.get_artwork_collection(1).unwrap();
    let request = || TrackDraft {
        track_id: 1,
        pictures: vec![
            PictureDraft::Existing {
                content_id: collection.images[0].content_id.clone(),
                picture_type: 255,
            },
            PictureDraft::New {
                data: image(20),
                picture_type: 3,
            },
        ],
        display_index: Some(1),
    };
    let result = save(&app, vec![1], vec![request()], false, vec![]).unwrap();
    assert!(result[0].database_updated && !result[0].file_written);
    assert_eq!(fs::read(fixture.0.join("1.flac")).unwrap(), original);
    let saved = database.get_artwork_collection(1).unwrap();
    assert_eq!(saved.images.len(), 2);
    assert_eq!(saved.images[0].picture.picture_type, 255);
    assert_eq!(saved.display_index, Some(1));

    let results = save(
        &app,
        vec![1, 2],
        vec![request(), draft(2, &[30])],
        true,
        vec![],
    )
    .unwrap();
    assert!(!results[0].file_written && !results[0].database_updated);
    assert!(results[0].error.is_some());
    assert!(results[1].file_written && results[1].database_updated);
    assert_eq!(fs::read(fixture.0.join("1.flac")).unwrap(), original);
    assert_eq!(
        database.get_artwork_collection(1).unwrap().images[0]
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

#[test]
fn whole_batch_validation_precedes_all_writes_and_rejects_old_cover_shape() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let original = fs::read(fixture.0.join("1.flac")).unwrap();
    let invalid = TrackDraft {
        track_id: 2,
        pictures: vec![PictureDraft::Existing {
            content_id: "missing".into(),
            picture_type: 3,
        }],
        display_index: Some(0),
    };
    assert!(save(
        &app,
        vec![1, 2],
        vec![draft(1, &[10]), invalid],
        true,
        vec![]
    )
    .is_err());
    assert_eq!(fs::read(fixture.0.join("1.flac")).unwrap(), original);
    assert!(app
        .state::<Database>()
        .get_artwork_collection(1)
        .unwrap()
        .images
        .is_empty());
    let mut invalid = draft(1, &[10]);
    invalid.display_index = Some(1);
    assert!(save(&app, vec![1], vec![invalid], false, vec![]).is_err());
    assert!(save(
        &app,
        vec![1],
        vec![draft(1, &[10]), draft(1, &[20])],
        false,
        vec![]
    )
    .is_err());
    assert!(save(&app, vec![1], vec![draft(2, &[10])], false, vec![]).is_err());
    assert!(serde_json::from_value::<MetadataSaveRequest>(
        json!({"trackIds":[1],"changes":[],"lyricsAction":"keep","cover":{"action":"delete"}})
    )
    .is_err());
}

#[test]
fn descriptions_lazy_extract_all_targets_without_blobs_and_content_ipc_returns_raw() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let database = app.state::<Database>();
    let pictures = vec![crate::artwork::collection::Picture {
        content: ArtworkContent {
            mime_type: "image/png".into(),
            image: image(10),
        },
        picture_type: 4,
    }];
    files::write_file_with_pictures(&fixture.0.join("1.flac"), &[], Some(&pictures)).unwrap();
    database
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO track_artwork_pending (track_id) VALUES (1),(2)",
            [],
        )
        .unwrap();
    let descriptions = tauri::async_runtime::block_on(commands::get_track_artwork_collections(
        vec![1, 2, 1, 99],
        app.handle().clone(),
    ))
    .unwrap();
    assert_eq!(
        descriptions
            .iter()
            .map(|description| description.track_id)
            .collect::<Vec<_>>(),
        [1, 2, 99]
    );
    assert_eq!(descriptions[0].pictures.len(), 1);
    assert!(descriptions[1].pictures.is_empty() && descriptions[1].error.is_none());
    assert!(descriptions[2].error.is_some());
    let json = serde_json::to_value(&descriptions).unwrap();
    assert_eq!(json[0]["pictures"][0]["mimeType"], "image/png");
    assert!(json[0]["pictures"][0].get("data").is_none());
    assert!(json[0]["pictures"][0].get("image").is_none());
    let id = descriptions[0].pictures[0].content_id.clone();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |size| {
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "get_artwork_content".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(json!({"contentId":id,"size":size})),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .map(|response| match response {
            tauri::ipc::InvokeResponseBody::Raw(bytes) => bytes,
            _ => panic!("Expected raw binary"),
        })
    };
    assert_eq!(invoke(None::<u32>).unwrap(), image(10));
    assert_eq!(
        image::guess_format(&invoke(Some(128)).unwrap()).unwrap(),
        image::ImageFormat::WebP
    );
    assert!(invoke(Some(0)).is_err());
    // Removing the display image does not restrict binary access to other collection members.
    let prepared = editing::prepare(&database, &[1], vec![draft(1, &[10, 20])], false).unwrap();
    crate::metadata::save::save_track_collection(
        &database,
        1,
        &[],
        LyricsMarkAction::Keep,
        Some(&prepared[0].1),
    );
    let collection = database.get_artwork_collection(1).unwrap();
    let hidden = &collection.images[1];
    assert_eq!(
        database
            .artwork_content_bytes(&hidden.content_id, None, |_, _| unreachable!())
            .unwrap(),
        image(20)
    );
}

#[test]
fn ipc_draft_shape_uses_camel_case_and_defaults_to_database_only() {
    let request: MetadataSaveRequest = serde_json::from_value(json!({
        "trackIds": [1], "changes": [], "lyricsAction": "keep",
        "artworkDrafts": [{ "trackId": 1, "displayIndex": 0, "pictures": [
            { "source": "existing", "contentId": "opaque-id", "pictureType": 3 },
            { "source": "new", "data": image(20), "pictureType": 4 }
        ] }]
    }))
    .unwrap();
    assert!(!request.embed_artwork);
    assert_eq!(request.artwork_drafts.len(), 1);
    assert!(
        matches!(&request.artwork_drafts[0].pictures[0], PictureDraft::Existing { content_id, picture_type: 3 } if content_id == "opaque-id")
    );
    assert!(matches!(
        &request.artwork_drafts[0].pictures[1],
        PictureDraft::New {
            picture_type: 4,
            ..
        }
    ));
    assert_eq!(request.artwork_drafts[0].display_index, Some(0));
    let invalid = json!({"trackId":1,"displayIndex":null,"pictures":[{"source":"existing","content_id":"wrong","pictureType":3}]});
    assert!(serde_json::from_value::<TrackDraft>(invalid).is_err());
}
