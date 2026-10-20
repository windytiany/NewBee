use super::*;

#[test]
fn numeric_commands_register_read_ingest_and_remove_without_path_identity() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    files::write_file(Path::new(&path), &[title("Inbox")]).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            register_inbox,
            read_inbox,
            ingest_inbox,
            remove_inbox
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str, args: serde_json::Value| {
        tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize::<serde_json::Value>()
        .unwrap()
    };
    let added = invoke(
        "register_inbox",
        serde_json::json!({"paths":[path], "directory":false}),
    );
    assert_eq!(added[0]["success"], true);
    assert_eq!(added[0]["skipped"], false);
    let track_id = added[0]["trackId"].as_i64().unwrap();
    files::write_file(Path::new(&path), &[title("Ingest")]).unwrap();
    files::access::take(&fixture.0);
    let write_guard = app.state::<WriteState>().acquire().unwrap();
    let read = invoke("read_inbox", serde_json::json!({}));
    drop(write_guard);
    assert_eq!(read["tracks"][0]["id"], track_id);
    assert_eq!(read["tracks"][0]["title"], "Inbox");
    assert!(read["tracks"][0]["addedAt"].is_i64());
    assert_eq!(read["failures"], serde_json::json!([]));
    assert!(files::access::take(&fixture.0).is_empty());
    let ingested = invoke(
        "ingest_inbox",
        serde_json::json!({"trackIds":[track_id,999]}),
    );
    assert_eq!(ingested[0]["trackId"], track_id);
    assert_eq!(ingested[0]["success"], true);
    assert_eq!(ingested[1]["trackId"], 999);
    assert_eq!(ingested[1]["success"], false);
    assert_eq!(
        app.state::<Database>()
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Ingest")
    );
    let again = invoke(
        "register_inbox",
        serde_json::json!({"paths":[path], "directory":false}),
    );
    assert_eq!(again[0]["trackId"], track_id);
    std::fs::remove_file(&path).unwrap();
    files::access::take(&fixture.0);
    assert_eq!(
        invoke("read_inbox", serde_json::json!({}))["tracks"][0]["id"],
        track_id
    );
    invoke("remove_inbox", serde_json::json!({"trackIds":[track_id]}));
    assert_eq!(
        invoke("read_inbox", serde_json::json!({}))["tracks"],
        serde_json::json!([])
    );
    assert!(files::access::take(&fixture.0).is_empty());
    assert!(app
        .state::<Database>()
        .get_track(track_id)
        .unwrap()
        .is_some());
}
