use super::*;
use crate::{database::Database, tracks};
use tauri::{Listener, Manager};

fn registrations(database: &Database, root: &std::path::Path) -> (Vec<i64>, Vec<String>) {
    let paths: Vec<_> = (1..=4)
        .map(|index| {
            let path = root.join(format!("{index}.flac"));
            std::fs::write(&path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
            path.canonicalize().unwrap().to_string_lossy().into_owned()
        })
        .collect();
    let ids = tracks::register(database, &paths)
        .unwrap()
        .into_iter()
        .map(|result| match result {
            tracks::model::TrackRegistrationResult::Registered { track, .. } => track.id,
            _ => panic!("fixture registration failed"),
        })
        .collect();
    (ids, paths)
}

fn request(handle: &PlaybackSession, command: SessionCommand) -> SessionReply {
    handle
        .request(command)
        .unwrap()
        .recv_timeout(Duration::from_secs(10))
        .unwrap()
        .unwrap()
}

#[test]
fn startup_restores_all_queue_and_separate_current_before_cleanup_and_pending_scan_exactly_once() {
    for path_current in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let database_path = directory.path().join("library.sqlite3");
        let database = Database::open(&database_path).unwrap();
        let (ids, paths) = registrations(&database, directory.path());
        let session_path = directory.path().join("session.json");
        let saved = SavedSession {
            queue: Queue::with_tracks(rows(&[ids[0], ids[1], ids[0]])),
            current_track: Some(ListeningTrack {
                track_id: (!path_current).then_some(ids[2]),
                path: Some(paths[2].clone()),
                title: None,
                artist: None,
            }),
            volume: VolumePreferences {
                volume: 73,
                last_non_muted_volume: 73,
            },
        };
        std::fs::write(&session_path, serde_json::to_vec(&saved).unwrap()).unwrap();
        let app = tauri::test::mock_builder()
            .manage(database)
            .manage(crate::locking::WriteState::default())
            .manage(tracks::ConfirmationState::default())
            .build(tauri::generate_context!())
            .unwrap();
        let audio = Arc::new(Mutex::new(FakeAudio {
            database: Some(Database::open(&database_path).unwrap()),
            ..FakeAudio::default()
        }));
        let (requests, receiver) = mpsc::channel();
        let generation = Arc::new(AtomicU64::new(0));
        let busy = Arc::new(AtomicBool::new(false));
        let handle = PlaybackSession {
            requests,
            generation: generation.clone(),
            busy: busy.clone(),
        };
        let (confirmed, events) = mpsc::channel();
        app.listen("tracks-confirmed", move |event| {
            confirmed
                .send(serde_json::from_str::<serde_json::Value>(event.payload()).unwrap())
                .unwrap();
        });
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let worker_calls = calls.clone();
        let worker_audio = audio.clone();
        let restored_audio = audio.clone();
        let worker_app = app.handle().clone();
        let expected = ids.clone();
        let worker = std::thread::spawn(move || {
            run_worker(
                worker_audio,
                session_path,
                generation,
                busy,
                receiver,
                |references| {
                    let audio = restored_audio.lock().unwrap();
                    assert_eq!(audio.metadata_reads.load(Ordering::SeqCst), 1);
                    assert_eq!(audio.volume, 73);
                    assert!(audio.starts.is_empty());
                    drop(audio);
                    assert!(worker_app
                        .state::<Database>()
                        .get_track(expected[3])
                        .unwrap()
                        .is_some());
                    worker_calls.fetch_add(1, Ordering::SeqCst);
                    tracks::resume(&worker_app, references);
                    assert!(worker_app
                        .state::<Database>()
                        .get_track(expected[3])
                        .unwrap()
                        .is_none());
                },
                (|_| {}, |_| {}),
            );
        });
        let snapshot = request(&handle, SessionCommand::Snapshot).snapshot;
        assert_eq!(
            snapshot
                .displayed_tracks
                .iter()
                .filter_map(|track| track.track_id)
                .collect::<Vec<_>>(),
            [ids[0], ids[1], ids[0]]
        );
        let current = snapshot.current_track.unwrap();
        assert_eq!(current.track_id, (!path_current).then_some(ids[2]));
        assert_eq!(current.path.as_deref(), Some(paths[2].as_str()));
        let event = events.recv_timeout(Duration::from_secs(10)).unwrap();
        let scanned: HashSet<_> = event
            .as_array()
            .unwrap()
            .iter()
            .map(|result| {
                assert_eq!(result["databaseUpdated"], true);
                result["trackId"].as_i64().unwrap()
            })
            .collect();
        assert_eq!(scanned, HashSet::from([ids[0], ids[1], ids[2]]));
        let database = app.state::<Database>();
        assert!(database.get_track(ids[3]).unwrap().is_none());
        for id in &ids[..3] {
            assert!(database
                .get_track(*id)
                .unwrap()
                .unwrap()
                .duration_ms
                .is_some());
        }
        let accesses = crate::metadata::files::access::take(directory.path());
        assert!(!accesses.is_empty());
        assert!(accesses
            .iter()
            .all(|(path, _)| path != &std::path::PathBuf::from(&paths[3])));
        request(&handle, SessionCommand::Clear);
        assert!(database.get_track(ids[0]).unwrap().is_some());
        assert!(database.get_track(ids[1]).unwrap().is_some());
        // New foreground registration after startup is not a second GC trigger.
        request(
            &handle,
            SessionCommand::Add {
                tracks: vec![QueueTrack {
                    track_id: None,
                    path: Some(paths[3].clone()),
                    row_key: "new".into(),
                    title: None,
                    album: None,
                    duration_ms: None,
                }],
                next: false,
            },
        );
        let snapshot = request(&handle, SessionCommand::Clear).snapshot;
        assert!(snapshot.displayed_tracks.is_empty());
        assert_eq!(database.pending_track_ids().unwrap().len(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(events.try_recv().is_err());
        drop(handle);
        worker.join().unwrap();
        audio.lock().unwrap().database.take();
        database.close_test_connection();
    }
}

#[test]
fn failed_or_incomplete_worker_restore_skips_cleanup_but_still_resumes_pending_scan() {
    for failure in ["json", "validation", "read", "metadata", "volume"] {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(":memory:").unwrap();
        let (ids, _) = registrations(&database, directory.path());
        let path = directory.path().join("session.json");
        let saved = SavedSession {
            queue: Queue::with_tracks(rows(&ids[..2])),
            ..SavedSession::default()
        };
        match failure {
            "json" => std::fs::write(&path, "{").unwrap(),
            "validation" => {
                let mut invalid = serde_json::to_value(&saved).unwrap();
                invalid["queue"]["displayedTracks"][0]["trackId"] = 0.into();
                std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            }
            "read" => std::fs::create_dir(&path).unwrap(),
            _ => std::fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap(),
        }
        let app = tauri::test::mock_builder()
            .manage(database)
            .manage(crate::locking::WriteState::default())
            .manage(tracks::ConfirmationState::default())
            .build(tauri::generate_context!())
            .unwrap();
        let (requests, receiver) = mpsc::channel();
        let (confirmed, events) = mpsc::channel();
        app.listen("tracks-confirmed", move |event| {
            confirmed.send(event.payload().to_owned()).unwrap();
        });
        let worker_app = app.handle().clone();
        // Disconnect immediately after startup; no runtime command can conceal
        // a load failure by replacing the persisted session with an empty one.
        drop(requests);
        run_worker(
            FakeAudio {
                metadata_failure: failure == "metadata",
                volume_failure: failure == "volume",
                ..FakeAudio::default()
            },
            path,
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicBool::new(false)),
            receiver,
            |references| {
                assert_eq!(
                    references.err(),
                    Some(if matches!(failure, "metadata" | "volume") {
                        "session_restore_incomplete"
                    } else {
                        "session_load_failed"
                    })
                );
                tracks::resume(&worker_app, Err("restore_failed"));
            },
            (|_| {}, |_| {}),
        );
        let event: serde_json::Value =
            serde_json::from_str(&events.recv_timeout(Duration::from_secs(10)).unwrap()).unwrap();
        assert_eq!(event.as_array().unwrap().len(), 4);
        let database = app.state::<Database>();
        for id in ids {
            assert!(
                database
                    .get_track(id)
                    .unwrap()
                    .unwrap()
                    .duration_ms
                    .is_some(),
                "{failure}"
            );
        }
    }
}

#[test]
fn missing_session_file_is_a_successful_empty_restore_not_a_restore_failure() {
    let directory = tempfile::tempdir().unwrap();
    let database = Database::open(":memory:").unwrap();
    let (ids, _) = registrations(&database, directory.path());
    let (requests, receiver) = mpsc::channel();
    drop(requests);
    run_worker(
        FakeAudio::default(),
        directory.path().join("absent.json"),
        Arc::new(AtomicU64::new(0)),
        Arc::new(AtomicBool::new(false)),
        receiver,
        |references| {
            let references = references.unwrap();
            assert!(references.ids.is_empty() && references.paths.is_empty());
            // The private SQL collector is not exposed to the session tests.
            let app = tauri::test::mock_builder()
                .manage(database)
                .manage(crate::locking::WriteState::default())
                .manage(tracks::ConfirmationState::default())
                .build(tauri::generate_context!())
                .unwrap();
            tracks::resume(app.handle(), Ok(references));
            for id in ids {
                assert!(app.state::<Database>().get_track(id).unwrap().is_none());
            }
        },
        (|_| {}, |_| {}),
    );
}
