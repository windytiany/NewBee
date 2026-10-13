use crate::{
    database::{tracks::persist_track, ArtworkUpdate, Database},
    locking::write::WriteState,
    metadata::{
        files,
        model::{LyricsMarkAction, MetadataChange, MetadataField},
        save::save_track,
    },
};
#[path = "tests/artwork.rs"]
mod artwork;

use serde_json::{json, Value};
use std::path::Path;
use tauri::Manager;

fn change(field: MetadataField, value: &str) -> MetadataChange {
    MetadataChange {
        field,
        value: Some(value.into()),
        values: Vec::new(),
    }
}

fn register(database: &Database, path: &Path) -> i64 {
    let track = files::read_track(path).unwrap().unwrap();
    let mut connection = database.connection().unwrap();
    let transaction = connection.transaction().unwrap();
    let id = persist_track(&transaction, &track, &ArtworkUpdate::Embedded).unwrap();
    transaction.commit().unwrap();
    id
}

pub(super) fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    args: Value,
) -> tauri::ipc::InvokeResponseBody {
    tauri::test::get_ipc_response(
        window,
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
    .unwrap()
}

#[test]
fn external_track_capabilities_use_snapshots_and_file_writes_do_not_grant_membership() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../fixtures/silence.flac")).unwrap();
    let path = path.canonicalize().unwrap();
    files::write_file_with_cover(
        &path,
        &[
            change(MetadataField::Title, "Original"),
            change(MetadataField::Lyrics, "embedded lyrics"),
        ],
        Some(files::CoverAction::Replace(
            &files::cover_picture(include_bytes!("../../fixtures/cover.png")).unwrap(),
        )),
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![
            super::commands::get_track,
            crate::metadata::get_editable_tracks,
            crate::lyrics::embedded::get_track_lyrics,
            crate::artwork::get_track_artwork,
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
    assert!(database.record_track_play(id).unwrap());
    let saved = save_track(
        &database,
        id,
        &[change(MetadataField::Title, "Written")],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(saved.file_written && saved.database_updated);
    assert!(saved.error.is_none());
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
    assert_eq!(
        database.list_playback_statistics().unwrap()[0].play_count,
        1
    );
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let queries = [
        ("get_track", json!({"trackId":id})),
        ("get_editable_tracks", json!({"trackIds":[id]})),
        ("get_track_lyrics", json!({"trackId":id})),
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
    for ((cmd, args), expected) in queries.iter().zip(snapshots) {
        assert_eq!(
            invoke(&window, cmd, args.clone())
                .deserialize::<Value>()
                .unwrap(),
            expected
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
    assert!(files::access::take(directory.path()).is_empty());
}

#[test]
fn explicit_reread_updates_external_references_and_returns_each_result_without_importing() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../fixtures/silence.flac")).unwrap();
    let app = tauri::test::mock_builder()
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .invoke_handler(tauri::generate_handler![super::commands::reread_track_tags])
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
    std::fs::write(&path, include_bytes!("../../fixtures/silence.flac")).unwrap();
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
    super::reading::reread(&database, id).unwrap();
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title(),
        Some("Written")
    );
    assert!(database.library_track_paths().unwrap().is_empty());
}
