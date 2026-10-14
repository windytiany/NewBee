use super::*;
use crate::{
    library::import::tests::support::TestFiles,
    metadata::{
        files,
        model::{MetadataChange, MetadataField},
    },
};

fn title(value: &str) -> MetadataChange {
    MetadataChange {
        field: MetadataField::Title,
        value: Some(value.into()),
        values: Vec::new(),
    }
}
fn id(database: &Database, path: &str) -> i64 {
    database
        .connection()
        .unwrap()
        .query_row("SELECT id FROM tracks WHERE path = ?1", [path], |row| {
            row.get(0)
        })
        .unwrap()
}
fn canonical(path: String) -> String {
    Path::new(&path)
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

#[test]
fn registration_and_ingest_rescan_once_preserving_identity_and_added_at() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    let database = Database::open(":memory:").unwrap();
    files::write_file(Path::new(&path), &[title("First")]).unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    let track_id = id(&database, &path);
    let playlist = database.create_playlist("Saved").unwrap();
    database
        .append_playlist_tracks(playlist, vec![track_id])
        .unwrap();
    database.record_track_play(track_id).unwrap();
    database.set_tracks_skipped(&[track_id], true).unwrap();
    database
        .connection()
        .unwrap()
        .execute("UPDATE inbox SET added_at = 123", [])
        .unwrap();
    files::write_file(Path::new(&path), &[title("External")]).unwrap();
    files::access::take(&fixture.0);
    let before = refresh(&database).unwrap();
    assert_eq!(before.tracks[0].track.title.as_deref(), Some("First"));
    assert_eq!(before.tracks[0].track.id, track_id);
    assert!(files::access::take(&fixture.0).is_empty());
    let result = register(&database, vec![path.clone()]);
    assert!(result[0].success && !result[0].skipped);
    assert_eq!(result[0].track_id, Some(track_id));
    assert_eq!(refresh(&database).unwrap().tracks[0].added_at, 123);
    assert_eq!(
        database
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("External")
    );
    files::write_file(Path::new(&path), &[title("Ingested")]).unwrap();
    files::access::take(&fixture.0);
    assert!(ingest(&database, vec![track_id])[0].success);
    assert_eq!(
        files::access::take(&fixture.0)
            .iter()
            .filter(|(_, kind)| *kind == "parse")
            .count(),
        1
    );
    assert_eq!(
        database.library_track_paths().unwrap(),
        std::slice::from_ref(&path)
    );
    assert!(database.inbox_paths().unwrap().is_empty());
    assert_eq!(
        database
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Ingested")
    );
    files::write_file(Path::new(&path), &[title("Inbox again")]).unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(id(&database, &path), track_id);
    assert_eq!(
        database.list_playback_statistics().unwrap()[0].play_count,
        1
    );
    assert_eq!(database.list_skipped_track_ids().unwrap(), [track_id]);
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap()[0]["title"],
        "Inbox again"
    );
}

#[test]
fn batch_failure_preserves_membership_and_last_successful_snapshot() {
    let fixture = TestFiles::new();
    let good = canonical(fixture.wav("good.wav"));
    let blocked = canonical(fixture.wav("blocked.wav"));
    let database = Database::open(":memory:").unwrap();
    for path in [&good, &blocked] {
        crate::library::import::import_track(&database, Path::new(path), &mut Default::default());
        files::write_file(Path::new(path), &[title("Changed")]).unwrap();
    }
    let blocked_id = id(&database, &blocked);
    database.connection().unwrap().execute_batch("CREATE TRIGGER reject_membership BEFORE UPDATE OF in_library ON tracks WHEN NEW.in_library = 0 AND OLD.path LIKE '%blocked.wav' BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
    let results = register(
        &database,
        vec![
            good.clone(),
            blocked.clone(),
            fixture.0.join("missing.wav").to_string_lossy().into_owned(),
        ],
    );
    assert!(results[0].success);
    assert!(!results[1].success && !results[2].success);
    assert!(results[1].error.as_deref().unwrap().contains("blocked"));
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&good));
    assert_eq!(
        database.library_track_paths().unwrap(),
        std::slice::from_ref(&blocked)
    );
    assert_eq!(database.get_track(blocked_id).unwrap().unwrap().title, None);
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_membership")
        .unwrap();
    assert!(register(&database, vec![blocked.clone()])[0].success);
    let good_id = id(&database, &good);
    std::fs::remove_file(&blocked).unwrap();
    let results = ingest(&database, vec![good_id, blocked_id]);
    assert!(results[0].success && !results[1].success);
    assert_eq!(
        database.inbox_paths().unwrap(),
        std::slice::from_ref(&blocked)
    );
    assert_eq!(
        refresh(&database).unwrap().tracks[0].track.title.as_deref(),
        Some("Changed")
    );
    assert!(refresh(&database).unwrap().failures.is_empty());
    assert!(!register(&database, vec![blocked.clone()])[0].success);
    assert_eq!(database.inbox_paths().unwrap(), [blocked]);
}

#[test]
fn artwork_failure_never_publishes_and_readers_use_confirmed_snapshots_offline() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    let cover = fixture.write("cover.png", include_bytes!("../../fixtures/cover.png"));
    let database = Database::open(":memory:").unwrap();
    files::write_file(Path::new(&path), &[title("Confirmed")]).unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    let track_id = id(&database, &path);
    let bytes = database
        .track_artwork_bytes(track_id, None, |_, _| unreachable!())
        .unwrap();
    assert_eq!(bytes, include_bytes!("../../fixtures/cover.png"));
    assert_eq!(
        database
            .get_artwork_collection(track_id)
            .unwrap()
            .images
            .len(),
        1
    );
    files::write_file(Path::new(&path), &[title("Unconfirmed")]).unwrap();
    std::fs::write(&cover, b"bad image").unwrap();
    assert!(!register(&database, vec![path.clone()])[0].success);
    assert!(!ingest(&database, vec![track_id])[0].success);
    assert!(crate::tracks::reading::reread(&database, track_id).is_err());
    assert_eq!(
        database
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Confirmed")
    );
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    std::fs::remove_file(&path).unwrap();
    std::fs::remove_file(&cover).unwrap();
    files::access::take(&fixture.0);
    assert_eq!(refresh(&database).unwrap().tracks[0].track.id, track_id);
    assert_eq!(
        database.get_editing_snapshot(track_id).unwrap().values[&MetadataField::Title],
        "Confirmed"
    );
    assert_eq!(
        database
            .track_artwork_bytes(track_id, None, |_, _| unreachable!())
            .unwrap(),
        bytes
    );
    assert_eq!(
        database.describe_artwork_collections(&[track_id]).unwrap()[0]
            .pictures
            .len(),
        1
    );
    assert!(files::access::take(&fixture.0).is_empty());
    database.remove_inbox_track(track_id).unwrap();
    assert!(database.inbox_paths().unwrap().is_empty());
    assert!(database.get_track(track_id).unwrap().is_some());
}

#[test]
fn recursive_registration_scans_duplicates_and_rejects_broken_new_files() {
    let fixture = TestFiles::new();
    std::fs::create_dir(fixture.0.join("nested")).unwrap();
    fixture.wav("one.wav");
    fixture.wav("nested/two.wav");
    fixture.write("broken.flac", b"not audio");
    fixture.write("ignored.txt", b"not audio");
    let database = Database::open(":memory:").unwrap();
    let results = register_directories(&database, vec![fixture.0.to_string_lossy().into_owned()]);
    assert_eq!(results.iter().filter(|result| result.success).count(), 2);
    assert_eq!(results.iter().filter(|result| !result.success).count(), 1);
    let again = register_directories(&database, vec![fixture.0.to_string_lossy().into_owned()]);
    assert_eq!(
        again
            .iter()
            .filter(|result| result.success && !result.skipped)
            .count(),
        2
    );
    assert_eq!(database.inbox_paths().unwrap().len(), 2);
}

#[test]
fn inbox_reopens_with_complete_snapshot_and_enforces_track_foreign_key() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    let storage = fixture.0.join("library.sqlite3");
    let database = Database::open(&storage).unwrap();
    files::write_file(
        Path::new(&path),
        &[
            title("Confirmed"),
            MetadataChange {
                field: MetadataField::Lyrics,
                value: Some("Embedded lyrics".into()),
                values: Vec::new(),
            },
        ],
    )
    .unwrap();
    std::fs::write(Path::new(&path).with_extension("lrc"), "Sidecar lyrics").unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    let track_id = id(&database, &path);
    let editing = database.get_editing_snapshot(track_id).unwrap();
    assert!(editing.writable_fields.contains(&MetadataField::Title));
    assert!(editing.writable_fields.contains(&MetadataField::Lyrics));
    assert_eq!(editing.values[&MetadataField::Lyrics], "Embedded lyrics");
    assert_eq!(
        database.get_lyrics(track_id).unwrap().text.as_deref(),
        Some("Embedded lyrics")
    );
    let snapshot = serde_json::to_value(editing).unwrap();
    database
        .connection()
        .unwrap()
        .execute("UPDATE inbox SET added_at=123", [])
        .unwrap();
    drop(database);
    std::fs::remove_file(&path).unwrap();
    let database = Database::open(&storage).unwrap();
    files::access::take(&fixture.0);
    let read = serde_json::to_value(refresh(&database).unwrap()).unwrap();
    assert_eq!(read["tracks"][0]["id"], track_id);
    assert_eq!(read["tracks"][0]["addedAt"], 123);
    assert_eq!(read["tracks"][0]["title"], "Confirmed");
    assert!(read["tracks"][0].get("lyrics").is_none());
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(track_id).unwrap()).unwrap(),
        snapshot
    );
    assert!(files::access::take(&fixture.0).is_empty());
    let connection = database.connection().unwrap();
    assert!(connection
        .execute("INSERT INTO inbox(track_id,added_at) VALUES (999,1)", [])
        .is_err());
    connection
        .execute("DELETE FROM tracks WHERE id=?1", [track_id])
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM inbox", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn initial_artwork_failure_registers_nothing_and_ingest_database_failure_is_atomic() {
    let fixture = TestFiles::new();
    let first = canonical(fixture.wav("first.wav"));
    let second = canonical(fixture.wav("second.wav"));
    let cover = fixture.write("cover.png", b"broken picture");
    let database = Database::open(":memory:").unwrap();
    assert!(!register(&database, vec![first.clone()])[0].success);
    assert!(database.inbox_entries().unwrap().is_empty());
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    std::fs::write(&cover, include_bytes!("../../fixtures/cover.png")).unwrap();
    for path in [&first, &second] {
        files::write_file(Path::new(path), &[title("Before")]).unwrap();
        assert!(register(&database, vec![path.clone()])[0].success);
    }
    let first_id = id(&database, &first);
    let second_id = id(&database, &second);
    let before = serde_json::to_value(database.get_track(first_id).unwrap()).unwrap();
    let editing = serde_json::to_value(database.get_editing_snapshot(first_id).unwrap()).unwrap();
    let original = database.get_artwork_collection(first_id).unwrap();
    let added_at = database.inbox_entries().unwrap()[0].1;
    for path in [&first, &second] {
        files::write_file(Path::new(path), &[title("After")]).unwrap();
    }
    std::fs::remove_file(&cover).unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(&format!(
            "CREATE TRIGGER reject_ingest BEFORE DELETE ON inbox WHEN OLD.track_id={} BEGIN
         UPDATE tracks SET title='side effect' WHERE id={};
         SELECT RAISE(FAIL, 'ingest failure'); END;",
            first_id, second_id
        ))
        .unwrap();
    let results = ingest(&database, vec![first_id, second_id]);
    assert!(!results[0].success && results[1].success);
    assert!(results[0]
        .error
        .as_deref()
        .unwrap()
        .contains("ingest failure"));
    assert_eq!(
        serde_json::to_value(database.get_track(first_id).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(first_id).unwrap()).unwrap(),
        editing
    );
    assert_eq!(
        database.get_artwork_collection(first_id).unwrap().images[0].content_id,
        original.images[0].content_id
    );
    assert_eq!(database.inbox_entries().unwrap(), [(first_id, added_at)]);
    assert_eq!(database.library_track_paths().unwrap(), [second]);
    assert_eq!(
        database
            .get_track(second_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("After")
    );
    assert!(database
        .get_artwork_collection(second_id)
        .unwrap()
        .images
        .is_empty());
}

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
    let read = invoke("read_inbox", serde_json::json!({}));
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
