use super::*;

#[test]
fn explicit_reread_updates_external_references_and_returns_each_result_without_importing() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            crate::tracks::commands::reread_track_tags
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let database = app.state::<Database>();
    let id = register(&database, &path.canonicalize().unwrap());
    let playlist = database.create_playlist("External").unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    files::write_file(
        &path,
        &[
            change(MetadataField::Title, "External edit"),
            change(MetadataField::Lyrics, "External lyrics"),
            change(MetadataField::Label, "External label"),
        ],
    )
    .unwrap();
    assert_ne!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("External edit")
    );
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let results: Value = invoke(
        &window,
        "reread_track_tags",
        json!({"trackIds":[id,999,id]}),
    )
    .deserialize()
    .unwrap();
    assert_eq!(results.as_array().unwrap().len(), 2);
    assert_eq!(
        results[0],
        json!({"trackId":id,"databaseUpdated":true,"error":null})
    );
    assert_eq!(results[1]["trackId"], 999);
    assert_eq!(results[1]["databaseUpdated"], false);
    assert!(results[1]["error"].is_string());
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("External edit")
    );
    assert_eq!(
        database.get_editing_snapshot(id).unwrap().values[&MetadataField::Label],
        "External label"
    );
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap()[0]["title"],
        "External edit"
    );
    assert!(database.library_track_paths().unwrap().is_empty());
    let before = serde_json::to_value(database.get_track(id).unwrap()).unwrap();
    std::fs::write(&path, b"invalid audio").unwrap();
    let results: Value = invoke(&window, "reread_track_tags", json!({"trackIds":[id]}))
        .deserialize()
        .unwrap();
    assert_eq!(results[0]["databaseUpdated"], false);
    assert_eq!(
        serde_json::to_value(database.get_track(id).unwrap()).unwrap(),
        before
    );
}

#[test]
fn external_file_success_survives_database_failure_and_reread_recovers_same_id() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = register(&database, &path.canonicalize().unwrap());
    database.connection().unwrap().execute_batch("CREATE TRIGGER fail_snapshot BEFORE UPDATE OF title ON tracks BEGIN SELECT RAISE(FAIL, 'unavailable'); END;").unwrap();
    let result = save_track(
        &database,
        id,
        &[change(MetadataField::Title, "Written")],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(result.file_written && !result.database_updated);
    assert!(result.error.unwrap().contains("数据库同步失败"));
    assert_eq!(
        files::read_track(&path).unwrap().unwrap().title.as_deref(),
        Some("Written")
    );
    assert_ne!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("Written")
    );
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_snapshot")
        .unwrap();
    crate::tracks::refresh::reread(&database, id).unwrap();
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("Written")
    );
    assert!(database.library_track_paths().unwrap().is_empty());
}
