use super::*;
use crate::metadata::files;
use crate::tracks::{model::TrackRegistrationResult, register};
use std::sync::Arc;
use tauri::Listener;

fn placeholders(database: &Database, root: &std::path::Path, count: usize) -> Vec<i64> {
    let paths: Vec<_> = (0..count)
        .map(|index| {
            let path = root.join(format!("{index}.flac"));
            std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
            path.to_string_lossy().into_owned()
        })
        .collect();
    register(database, &paths)
        .unwrap()
        .into_iter()
        .map(|result| match result {
            TrackRegistrationResult::Registered { track, .. } => track.id,
            _ => panic!("registration failed"),
        })
        .collect()
}

fn wait(state: &ConfirmationState) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while state.0.lock().unwrap().running {
        assert!(
            std::time::Instant::now() < deadline,
            "worker did not finish"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn concurrent_enqueue_has_one_worker_and_priority_does_not_duplicate_work() {
    let state = ConfirmationState::default();
    let starts = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..32 {
            scope.spawn(|| {
                if state.enqueue(1..=35) {
                    starts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
            });
        }
    });
    assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 1);
    state.prioritize(35);
    assert_eq!(state.next(), Some(35));
    let ids: Vec<_> = (0..34).filter_map(|_| state.next()).collect();
    assert_eq!(ids, (1..35).collect::<Vec<_>>());
    assert_eq!(state.next(), None);
    assert!(!state.finish(&(1..=35).collect::<Vec<_>>()));
    state.stop();
    assert!(!state.enqueue([36]));
}

#[test]
fn bounded_batches_publish_once_and_repeated_registration_never_rescans() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let ids = placeholders(&database, directory.path(), 35);
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(crate::locking::WriteState::default())
        .manage(ConfirmationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let batches = Arc::new(Mutex::new(Vec::<Vec<i64>>::new()));
    let observed = batches.clone();
    app.listen("tracks-confirmed", move |event| {
        let results: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
        observed.lock().unwrap().push(
            results
                .as_array()
                .unwrap()
                .iter()
                .map(|result| result["trackId"].as_i64().unwrap())
                .collect(),
        );
    });
    assert!(app.state::<ConfirmationState>().enqueue(ids.clone()));
    app.state::<ConfirmationState>().prioritize(ids[34]);
    schedule(app.handle(), ids.clone());
    drain(app.handle());
    wait(&app.state::<ConfirmationState>());
    let published = batches.lock().unwrap();
    assert_eq!(
        published.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![16, 16, 3]
    );
    assert_eq!(published[0][0], ids[34]);
    assert_eq!(
        published
            .iter()
            .flatten()
            .copied()
            .collect::<HashSet<_>>()
            .len(),
        35
    );
    drop(published);
    let database = app.state::<Database>();
    assert!(database.pending_track_ids().unwrap().is_empty());
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(database.artwork_decode_count(), 0);
    files::access::take(directory.path());
    let again = register(
        &database,
        &[directory.path().to_string_lossy().into_owned()],
    )
    .unwrap();
    assert!(again.iter().all(|result| matches!(
        result,
        TrackRegistrationResult::Registered {
            needs_metadata: false,
            ..
        }
    )));
    schedule(app.handle(), ids);
    wait(&app.state::<ConfirmationState>());
    assert!(files::access::take(directory.path()).is_empty());
    assert_eq!(batches.lock().unwrap().len(), 3);
}

#[test]
fn partial_tag_failure_keeps_playable_path_and_explicit_reread_can_retry() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let ids = placeholders(&database, directory.path(), 2);
    let path = database.get_track(ids[1]).unwrap().unwrap().path;
    std::fs::write(&path, b"broken tags").unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(crate::locking::WriteState::default())
        .manage(ConfirmationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    schedule(app.handle(), ids.clone());
    wait(&app.state::<ConfirmationState>());
    let database = app.state::<Database>();
    assert!(database
        .get_track(ids[0])
        .unwrap()
        .unwrap()
        .duration_ms
        .is_some());
    assert_eq!(
        database
            .get_track_for_playback(ids[1])
            .unwrap()
            .unwrap()
            .path,
        path
    );
    let failed = database.get_editing_snapshot(ids[1]).unwrap();
    assert!(failed.writable_fields.is_empty());
    assert!(failed.issue.is_some());
    assert!(database.pending_track_ids().unwrap().is_empty());
    files::access::take(directory.path());
    schedule(app.handle(), ids.clone());
    wait(&app.state::<ConfirmationState>());
    assert!(files::access::take(directory.path()).is_empty());
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    crate::tracks::refresh::reread(&database, ids[1]).unwrap();
    assert!(database
        .get_editing_snapshot(ids[1])
        .unwrap()
        .issue
        .is_none());
    assert!(rodio::Decoder::try_from(std::fs::File::open(path).unwrap()).is_ok());
}

#[test]
fn confirmation_cannot_overwrite_foreground_edit_or_reread_and_preserves_external_lyrics() {
    use crate::metadata::{
        model::{LyricsMarkAction, MetadataChange, MetadataField},
        save::save_track,
    };
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let ids = placeholders(&database, directory.path(), 2);
    let stale: Vec<_> = ids
        .iter()
        .map(|id| {
            let path = database.get_track(*id).unwrap().unwrap().path;
            Confirmation {
                revision: 0,
                id: *id,
                snapshot: Ok(
                    crate::tracks::inspect(&database, std::path::Path::new(&path)).unwrap(),
                ),
                path,
            }
        })
        .collect();
    let result = save_track(
        &database,
        ids[0],
        &[
            MetadataChange {
                field: MetadataField::Title,
                value: Some("Edited".into()),
                values: Vec::new(),
            },
            MetadataChange {
                field: MetadataField::Lyrics,
                value: Some("Embedded lyrics".into()),
                values: Vec::new(),
            },
        ],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(
        result.file_written && result.database_updated,
        "{:?}",
        result.error
    );
    let path = database.get_track(ids[1]).unwrap().unwrap().path;
    files::write_file(
        std::path::Path::new(&path),
        &[MetadataChange {
            field: MetadataField::Title,
            value: Some("Reread".into()),
            values: Vec::new(),
        }],
    )
    .unwrap();
    crate::tracks::refresh::reread(&database, ids[1]).unwrap();
    assert!(database.confirm_tracks(stale).unwrap().is_empty());
    assert_eq!(
        database.get_track(ids[0]).unwrap().unwrap().title(),
        Some("Edited")
    );
    assert_eq!(
        database.get_track(ids[1]).unwrap().unwrap().title(),
        Some("Reread")
    );
    assert_eq!(
        database.get_lyrics(ids[0]).unwrap().text.as_deref(),
        Some("Embedded lyrics")
    );
    let edited = database.get_track(ids[0]).unwrap().unwrap();
    assert_eq!(
        files::read_track(std::path::Path::new(&edited.path))
            .unwrap()
            .unwrap()
            .lyrics
            .as_deref(),
        Some("Embedded lyrics")
    );
    assert!(database.library_track_paths().unwrap().is_empty());
}

#[test]
fn stopped_pending_work_resumes_on_restart_but_confirmed_failures_do_not_retry() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("tracks.sqlite3");
    let database = Database::open(&path).unwrap();
    let ids = placeholders(&database, directory.path(), 2);
    let broken = database.get_track(ids[1]).unwrap().unwrap().path;
    std::fs::write(&broken, b"broken").unwrap();
    let state = ConfirmationState::default();
    assert!(state.enqueue(ids.clone()));
    state.stop();
    assert!(!state.finish(&[]));
    drop(database);
    let app = tauri::test::mock_builder()
        .manage(Database::open(&path).unwrap())
        .manage(crate::locking::WriteState::default())
        .manage(ConfirmationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    initialize(app.handle());
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while app
        .state::<Database>()
        .get_editing_snapshot(ids[1])
        .is_err()
    {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    wait(&app.state::<ConfirmationState>());
    assert!(app
        .state::<Database>()
        .get_track(ids[0])
        .unwrap()
        .unwrap()
        .duration_ms
        .is_some());
    app.state::<Database>().close_test_connection();
    let reopened = Database::open(&path).unwrap();
    assert!(reopened.pending_track_ids().unwrap().is_empty());
    assert!(reopened
        .get_editing_snapshot(ids[1])
        .unwrap()
        .issue
        .is_some());
}

#[test]
fn database_failure_is_reported_once_without_an_automatic_retry_loop() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let ids = placeholders(&database, directory.path(), 2);
    database.connection().unwrap().execute_batch(
        "CREATE TRIGGER fail_confirmation BEFORE INSERT ON track_editing BEGIN SELECT RAISE(FAIL, 'confirmation failure'); END;",
    ).unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(crate::locking::WriteState::default())
        .manage(ConfirmationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    app.listen("tracks-confirmed", move |event| {
        observed
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });
    schedule(app.handle(), ids.clone());
    wait(&app.state::<ConfirmationState>());
    std::thread::sleep(Duration::from_millis(100));
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].as_array().unwrap().len(), 2);
    for result in events[0].as_array().unwrap() {
        assert_eq!(result["databaseUpdated"], false);
        assert!(result["error"]
            .as_str()
            .unwrap()
            .contains("confirmation failure"));
    }
    assert_eq!(app.state::<Database>().pending_track_ids().unwrap(), ids);
    assert!(app
        .state::<Database>()
        .get_track(ids[0])
        .unwrap()
        .unwrap()
        .duration_ms
        .is_none());
}

#[test]
fn stale_background_read_cannot_publish_after_file_write_with_failed_database_sync() {
    use crate::metadata::{
        model::{LyricsMarkAction, MetadataChange, MetadataField},
        save::save_track,
    };
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let id = placeholders(&database, directory.path(), 1)[0];
    let (path, revision) = database.pending_track(id).unwrap().unwrap();
    let stale = Confirmation {
        id,
        revision,
        path: path.clone(),
        snapshot: Ok(crate::tracks::inspect(&database, std::path::Path::new(&path)).unwrap()),
    };
    database.connection().unwrap().execute_batch("CREATE TRIGGER fail_snapshot BEFORE INSERT ON track_editing BEGIN SELECT RAISE(FAIL, 'snapshot failure'); END;").unwrap();
    let result = save_track(
        &database,
        id,
        &[MetadataChange {
            field: MetadataField::Title,
            value: Some("Written".into()),
            values: Vec::new(),
        }],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(result.file_written);
    assert!(!result.database_updated);
    assert_eq!(
        files::read_track(std::path::Path::new(&path))
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Written")
    );
    assert!(database.confirm_tracks(vec![stale]).unwrap().is_empty());
    assert_eq!(database.get_track(id).unwrap().unwrap().title(), Some("0"));
    assert!(database.pending_track(id).unwrap().is_some());
}

#[test]
fn target_database_failure_rolls_back_side_effects_and_confirms_later_targets() {
    use crate::metadata::model::{MetadataChange, MetadataField};
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let ids = placeholders(&database, directory.path(), 3);
    let cover = files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    for id in &ids {
        let path = database.get_track(*id).unwrap().unwrap().path;
        files::write_file_with_cover(
            std::path::Path::new(&path),
            &[
                MetadataChange {
                    field: MetadataField::Title,
                    value: Some(format!("Confirmed {id}")),
                    values: Vec::new(),
                },
                MetadataChange {
                    field: MetadataField::Lyrics,
                    value: Some("Embedded".into()),
                    values: Vec::new(),
                },
            ],
            Some(files::CoverAction::Replace(&cover)),
        )
        .unwrap();
    }
    let before = serde_json::to_value(database.get_track(ids[1]).unwrap()).unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(&format!(
            "CREATE TRIGGER fail_one BEFORE INSERT ON track_lyrics WHEN NEW.track_id = {} BEGIN
         UPDATE tracks SET title = 'trigger side effect' WHERE id = {};
         SELECT RAISE(FAIL, 'target failure'); END;",
            ids[1], ids[0]
        ))
        .unwrap();
    let app = tauri::test::mock_builder()
        .manage(database)
        .manage(crate::locking::WriteState::default())
        .manage(ConfirmationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    app.listen("tracks-confirmed", move |event| {
        observed
            .lock()
            .unwrap()
            .push(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap());
    });
    schedule(app.handle(), ids.clone());
    wait(&app.state::<ConfirmationState>());
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    let results = events[0].as_array().unwrap();
    assert_eq!(results.len(), 3);
    for (index, id) in ids.iter().enumerate() {
        assert_eq!(results[index]["trackId"], *id);
        assert_eq!(results[index]["databaseUpdated"], index != 1);
        if index == 1 {
            assert!(results[index]["error"]
                .as_str()
                .unwrap()
                .contains("target failure"));
        } else {
            assert!(results[index]["error"].is_null());
        }
    }
    let database = app.state::<Database>();
    assert_eq!(
        serde_json::to_value(database.get_track(ids[1]).unwrap()).unwrap(),
        before
    );
    assert!(database.get_editing_snapshot(ids[1]).is_err());
    assert!(database
        .get_artwork_collection(ids[1])
        .unwrap()
        .images
        .is_empty());
    assert!(database.get_lyrics(ids[1]).unwrap().text.is_none());
    assert_eq!(database.pending_track_ids().unwrap(), [ids[1]]);
    for id in [ids[0], ids[2]] {
        assert_eq!(
            database.get_track(id).unwrap().unwrap().title,
            Some(format!("Confirmed {id}"))
        );
        assert_eq!(
            database.get_lyrics(id).unwrap().text.as_deref(),
            Some("Embedded")
        );
        assert_eq!(
            database.get_artwork_collection(id).unwrap().images[0]
                .picture
                .content
                .image,
            cover.data()
        );
        assert!(database
            .get_editing_snapshot(id)
            .unwrap()
            .writable_fields
            .contains(&MetadataField::Title));
    }
    files::access::take(directory.path());
    std::thread::sleep(Duration::from_millis(100));
    assert!(files::access::take(directory.path()).is_empty());
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_one")
        .unwrap();
    crate::tracks::refresh::reread(&database, ids[1]).unwrap();
    assert!(database.pending_track_ids().unwrap().is_empty());
}
