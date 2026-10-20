use super::*;

#[test]
fn external_track_capabilities_use_snapshots_and_file_writes_do_not_grant_membership() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let path = path.canonicalize().unwrap();
    files::write_file_with_cover(
        &path,
        &[
            change(MetadataField::Title, "Original"),
            change(MetadataField::Lyrics, "embedded lyrics"),
        ],
        Some(files::CoverAction::Replace(
            &files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap(),
        )),
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            crate::tracks::commands::get_track,
            crate::metadata::get_editable_tracks,
            crate::lyrics::embedded::get_track_lyrics,
            crate::artwork::track::commands::get_track_artwork,
            crate::artwork::track::commands::get_track_artwork_collections,
            crate::tracks::commands::reread_track_tags,
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let database = app.state::<Database>();
    let id = register(&database, &path);
    assert_eq!(register(&database, &path), id);
    let playlist = database.create_playlist("External").unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    database.set_tracks_skipped(&[id], true).unwrap();
    assert!(!database.record_track_play(id).unwrap());
    let saved = save_track(
        &database,
        id,
        &[change(MetadataField::Title, "Written")],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(saved.file_written && saved.database_updated);
    assert!(saved.error.is_none());
    let embedded = files::artwork::read_embedded_pictures(&path).unwrap();
    assert_eq!(embedded.len(), 1);
    assert_eq!(
        embedded[0].content.image,
        include_bytes!("../../../fixtures/cover.png")
    );
    assert_eq!(
        database.get_artwork_collection(id).unwrap().images[0]
            .picture
            .content
            .image,
        embedded[0].content.image
    );
    assert_eq!(
        files::read_track(&path).unwrap().unwrap().title.as_deref(),
        Some("Written")
    );
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("Written")
    );
    assert!(database.library_track_paths().unwrap().is_empty());
    let entries = database.list_playlist_tracks(playlist).unwrap();
    let entries = serde_json::to_value(entries).unwrap();
    assert_ne!(entries[0]["playlistItemId"], entries[1]["playlistItemId"]);
    assert_eq!(entries[0]["title"], "Written");
    assert_eq!(database.list_skipped_track_ids().unwrap(), [id]);
    assert!(database.list_playback_statistics().unwrap().is_empty());
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let queries = [
        ("get_track", json!({"trackId":id})),
        ("get_editable_tracks", json!({"trackIds":[id]})),
        ("get_track_lyrics", json!({"trackId":id})),
        ("get_track_artwork_collections", json!({"trackIds":[id]})),
    ];
    let snapshots: Vec<Value> = queries
        .iter()
        .map(|(cmd, args)| invoke(&window, cmd, args.clone()).deserialize().unwrap())
        .collect();
    assert_eq!(snapshots[0]["title"], "Written");
    assert_eq!(snapshots[1][0]["values"]["title"], "Written");
    assert_eq!(
        snapshots[2],
        json!({"kind":"plain", "text":"embedded lyrics"})
    );
    let cover = invoke(
        &window,
        "get_track_artwork",
        json!({"trackId":id,"size":128}),
    );
    let tauri::ipc::InvokeResponseBody::Raw(cover) = cover else {
        panic!("Expected cover")
    };
    assert!(!cover.is_empty());
    std::fs::remove_file(&path).unwrap();
    files::access::take(directory.path());
    for ((cmd, args), expected) in queries.iter().zip(&snapshots) {
        assert_eq!(
            invoke(&window, cmd, args.clone())
                .deserialize::<Value>()
                .unwrap(),
            *expected
        );
    }
    let tauri::ipc::InvokeResponseBody::Raw(offline_cover) = invoke(
        &window,
        "get_track_artwork",
        json!({"trackId":id,"size":128}),
    ) else {
        panic!("Expected cover")
    };
    assert_eq!(offline_cover, cover);
    assert_eq!(
        database.get_artwork_collection(id).unwrap().images[0]
            .picture
            .content
            .image,
        embedded[0].content.image
    );
    assert!(files::access::take(directory.path()).is_empty());
    let failed: Value = invoke(&window, "reread_track_tags", json!({"trackIds":[id]}))
        .deserialize()
        .unwrap();
    assert_eq!(failed[0]["databaseUpdated"], false);
    assert!(failed[0]["error"].is_string());
    files::access::take(directory.path());
    for ((cmd, args), expected) in queries.iter().zip(&snapshots) {
        assert_eq!(
            invoke(&window, cmd, args.clone())
                .deserialize::<Value>()
                .unwrap(),
            *expected
        );
    }
    assert_eq!(
        database.get_artwork_collection(id).unwrap().images[0]
            .picture
            .content
            .image,
        embedded[0].content.image
    );
    assert!(files::access::take(directory.path()).is_empty());
}
