use super::*;

#[test]
fn descriptions_use_confirmed_snapshots_without_file_io_and_content_ipc_returns_raw() {
    let fixture = Fixture::new();
    let app = app(&fixture, 2);
    let database = app.state::<Database>();
    let pictures = vec![crate::artwork::track::Picture {
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
                snapshot: crate::tracks::inspect(&database, std::path::Path::new(&path)),
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
