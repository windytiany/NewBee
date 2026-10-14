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
            commands::get_artwork_picture,
            crate::artwork::collection::linked::read_artwork_file,
            crate::artwork::collection::plan::get_artwork_write_plan
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
            .map(|(index, color)| PictureDraft::Embedded {
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
    changes: Vec<crate::metadata::model::MetadataChange>,
) -> Result<Vec<super::super::MetadataSaveResult>, String> {
    tauri::async_runtime::block_on(save_track_metadata(
        MetadataSaveRequest {
            track_ids: ids,
            changes,
            lyrics_action: LyricsMarkAction::Keep,
            artwork_drafts: drafts,
        },
        tauri::ipc::Channel::new(|_| Ok(())),
        None,
        app.handle().clone(),
        app.state(),
    ))
}

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
    assert!(crate::tracks::reading::reread(&database, 1).is_err());
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
fn descriptions_use_confirmed_snapshots_without_file_io_and_content_ipc_returns_raw() {
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
    database
        .connection()
        .unwrap()
        .execute("DELETE FROM track_editing", [])
        .unwrap();
    files::access::take(&fixture.0);
    let pending = tauri::async_runtime::block_on(commands::get_track_artwork_collections(
        vec![1, 2, 1, 99],
        app.handle().clone(),
    ))
    .unwrap();
    assert!(pending[0].pictures.is_empty() && pending[0].error.is_none());
    assert!(pending[1].pictures.is_empty() && pending[1].error.is_none());
    assert!(pending[2].error.is_some());
    assert!(files::access::take(&fixture.0).is_empty());
    let batch = [1, 2]
        .into_iter()
        .map(|id| {
            let (path, revision) = database.pending_track(id).unwrap().unwrap();
            crate::database::tracks::confirmation::Confirmation {
                id,
                revision,
                snapshot: crate::tracks::scanning::scan(&database, std::path::Path::new(&path)),
                path,
            }
        })
        .collect();
    let results = database.confirm_tracks(batch).unwrap();
    assert!(results
        .iter()
        .all(|result| result.database_updated && result.error.is_none()));
    files::access::take(&fixture.0);
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
    assert!(files::access::take(&fixture.0).is_empty());
    let json = serde_json::to_value(&descriptions).unwrap();
    assert_eq!(json[0]["pictures"][0]["mimeType"], "image/png");
    assert!(json[0]["pictures"][0].get("data").is_none());
    assert!(json[0]["pictures"][0].get("image").is_none());
    let id = descriptions[0].pictures[0].artwork_id;
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |size| {
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "get_artwork_picture".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(json!({"artworkId":id,"size":size})),
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
    let prepared = editing::prepare(&database, draft(1, &[10, 20])).unwrap();
    crate::metadata::save::save_track_collection(
        &database,
        1,
        &[],
        LyricsMarkAction::Keep,
        Some(&prepared),
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
fn ipc_draft_shape_requires_storage_choice_and_artwork_identity() {
    let request: MetadataSaveRequest = serde_json::from_value(json!({
        "trackIds":[1], "changes":[], "lyricsAction":"keep", "artworkDrafts":[{"trackId":1,"displayIndex":0,"pictures":[
            {"source":"existing","artworkId":7,"pictureType":3},
            {"source":"embedded","data":image(20),"pictureType":4},
            {"source":"linked","path":"C:/cover.png","pictureType":18}
        ]}]
    })).unwrap();
    assert_eq!(request.artwork_drafts.len(), 1);
    assert!(matches!(
        request.artwork_drafts[0].pictures[0],
        PictureDraft::Existing {
            artwork_id: 7,
            picture_type: 3
        }
    ));
    assert!(matches!(
        request.artwork_drafts[0].pictures[1],
        PictureDraft::Embedded {
            picture_type: 4,
            ..
        }
    ));
    assert!(matches!(
        request.artwork_drafts[0].pictures[2],
        PictureDraft::Linked {
            picture_type: 18,
            ..
        }
    ));
    assert_eq!(request.artwork_drafts[0].display_index, Some(0));
    for item in [
        json!({"source":"existing","contentId":"old","pictureType":3}),
        json!({"source":"new","data":[1],"pictureType":3}),
    ] {
        assert!(serde_json::from_value::<TrackDraft>(
            json!({"trackId":1,"displayIndex":null,"pictures":[item]})
        )
        .is_err());
    }
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

#[test]
fn write_plan_matches_actual_writes_without_committing_and_external_image_ipc_returns_typed_bytes()
{
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let path = fixture.0.join("external.png");
    fs::write(&path, image(10)).unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |command: &str, args: serde_json::Value| {
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
    };
    let bytes: Vec<u8> = invoke("read_artwork_file", json!({"path":path}))
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(bytes, image(10));
    assert!(invoke(
        "read_artwork_file",
        json!({"path":fixture.0.join("missing.png")})
    )
    .is_err());
    fs::write(&path, b"invalid").unwrap();
    assert!(invoke("read_artwork_file", json!({"path":path})).is_err());
    fs::write(&path, image(10)).unwrap();
    let request = json!({"artworkDrafts":[
        {"trackId":1,"pictures":[{"source":"embedded","data":image(10),"pictureType":3}],"displayIndex":0},
        {"trackId":2,"pictures":[{"source":"linked","path":path,"pictureType":3}],"displayIndex":0}
    ]});
    let plan: serde_json::Value = invoke("get_artwork_write_plan", request.clone())
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(
        plan,
        json!([
            {"trackId":1,"fileWriteRequired":true,"error":null},
            {"trackId":2,"fileWriteRequired":false,"error":null}
        ])
    );
    for id in [1, 2] {
        assert!(app
            .state::<Database>()
            .get_artwork_collection(id)
            .unwrap()
            .images
            .is_empty());
        assert!(
            files::artwork::read_collection(&fixture.0.join(format!("{id}.flac")))
                .embedded
                .unwrap()
                .is_empty()
        );
    }
    let drafts: Vec<TrackDraft> = serde_json::from_value(request["artworkDrafts"].clone()).unwrap();
    let result = save(&app, vec![1, 2], drafts, vec![]).unwrap();
    assert!(result[0].file_written && result[0].database_updated);
    assert!(!result[1].file_written && result[1].database_updated);
    let plan: serde_json::Value = invoke("get_artwork_write_plan", request)
        .unwrap()
        .deserialize()
        .unwrap();
    assert_eq!(plan[0]["fileWriteRequired"], false);
    assert_eq!(plan[1]["fileWriteRequired"], false);
    let plan:serde_json::Value = invoke("get_artwork_write_plan",json!({"artworkDrafts":[
        {"trackId":1,"pictures":[{"source":"existing","artworkId":999,"pictureType":3}],"displayIndex":0},
        {"trackId":2,"pictures":[],"displayIndex":null}
    ]})).unwrap().deserialize().unwrap();
    assert!(plan[0]["error"].is_string());
    assert_eq!(plan[1]["error"], serde_json::Value::Null);
    assert_eq!(plan[1]["fileWriteRequired"], false);
}
