use super::*;

#[test]
fn background_worker_advances_and_persists_without_any_webview_or_status_requests() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("newbee-headless-session-{unique}.json"));
    let (requests, receiver) = mpsc::channel();
    let generation = Arc::new(AtomicU64::new(0));
    let busy = Arc::new(AtomicBool::new(false));
    let handle = PlaybackSession {
        requests,
        generation: generation.clone(),
        busy: busy.clone(),
    };
    let audio = Arc::new(Mutex::new(FakeAudio::default()));
    let worker_audio = audio.clone();
    let worker_path = path.clone();
    let (observed, snapshots) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        run_worker(
            worker_audio,
            worker_path,
            generation,
            busy,
            receiver,
            |snapshot| {
                observed.send(snapshot.clone()).unwrap();
            },
        )
    });
    let reply = handle
        .request(SessionCommand::PlayTracks {
            tracks: rows(&[1, 2, 3]),
            start_row_key: "row:0".into(),
            allow_skipped: true,
        })
        .unwrap()
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    assert_eq!(reply.snapshot.current_track.unwrap().track_id, Some(1));
    // From this point there are no commands, IPC polls, WebViews or frontend timers.
    // The audio source ends and the Rust worker itself must select and start row 2.
    audio.lock().unwrap().ended = true;
    loop {
        let snapshot = snapshots
            .recv_timeout(Duration::from_secs(2))
            .expect("backend did not advance autonomously");
        if snapshot
            .current_track
            .as_ref()
            .is_some_and(|track| track.track_id == Some(2))
            && !snapshot.is_command_pending
        {
            break;
        }
    }
    assert_eq!(audio.lock().unwrap().starts, [1, 2]);
    audio.lock().unwrap().ended = true;
    loop {
        let snapshot = snapshots
            .recv_timeout(Duration::from_secs(2))
            .expect("backend did not continue autonomously");
        if snapshot
            .current_track
            .as_ref()
            .is_some_and(|track| track.track_id == Some(3))
            && !snapshot.is_command_pending
        {
            break;
        }
    }
    assert_eq!(audio.lock().unwrap().starts, [1, 2, 3]);
    let (_, saved) = SessionPersistence::load(path.clone());
    assert_eq!(saved.queue.current_row_key.as_deref(), Some("row:2"));
    drop(handle);
    worker.join().unwrap();
    std::fs::remove_file(path).unwrap();
}

#[test]
fn tray_and_windows_media_actions_map_to_one_backend_session_entry() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    for action in [
        "pause", "pause", "play", "play", "next", "previous", "toggle",
    ] {
        let command = SessionCommand::System {
            operation: system_operation(action).unwrap(),
        };
        execute(&mut session, command);
    }
    assert_eq!(session.audio.starts, [1, 2, 1]);
    assert!(!session.audio.playing);
    assert!(system_operation("unknown").is_none());
    execute(&mut session, SessionCommand::BeginSeeking);
    assert!(
        !execute(
            &mut session,
            SessionCommand::System {
                operation: system_operation("next").unwrap()
            }
        )
        .0
    );
    assert_eq!(session.audio.starts, [1, 2, 1]);
    let playback_id = session.playback_id;
    execute(
        &mut session,
        SessionCommand::Seek {
            position_ms: 0,
            playback_id,
        },
    );
    let token = execute(
        &mut session,
        SessionCommand::BeginEditing {
            paths: Vec::new(),
            track_ids: vec![1],
        },
    )
    .2
    .unwrap();
    assert!(
        !execute(
            &mut session,
            SessionCommand::System {
                operation: system_operation("play").unwrap()
            }
        )
        .0
    );
    execute(&mut session, SessionCommand::EndEditing { token });
    execute(
        &mut session,
        SessionCommand::System {
            operation: system_operation("play").unwrap(),
        },
    );
    assert_eq!(session.audio.starts, [1, 2, 1, 1]);
}

#[test]
fn large_queue_progress_reads_and_unchanged_snapshot_neither_save_nor_broadcast() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("newbee-session-readonly-{unique}.json"));
    let saved = SavedSession {
        queue: Queue::with_tracks(rows(&vec![1; 10_000])),
        current_track: None,
        volume: VolumePreferences::default(),
    };
    std::fs::write(&path, serde_json::to_string(&saved).unwrap()).unwrap();
    let original_modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let (requests, receiver) = mpsc::channel();
    let generation = Arc::new(AtomicU64::new(0));
    let busy = Arc::new(AtomicBool::new(false));
    let handle = PlaybackSession {
        requests,
        generation: generation.clone(),
        busy: busy.clone(),
    };
    let worker_path = path.clone();
    let (observed, snapshots) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        run_worker(
            FakeAudio::default(),
            worker_path,
            generation,
            busy,
            receiver,
            |snapshot| {
                observed.send(snapshot.clone()).unwrap();
            },
        )
    });
    let snapshot = handle
        .request(SessionCommand::Snapshot)
        .unwrap()
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap()
        .snapshot;
    assert_eq!(snapshot.displayed_tracks.len(), 10_000);
    assert_eq!(snapshot.revision, 0);
    for _ in 0..10 {
        let progress = handle
            .progress()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        assert_eq!(progress.revision, 0);
        let json = serde_json::to_value(progress).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 2);
        assert!(json.get("displayedTracks").is_none());
        assert!(json.get("playbackStatus").is_some());
    }
    std::thread::sleep(Duration::from_millis(70));
    assert!(matches!(
        snapshots.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        original_modified
    );
    drop(handle);
    worker.join().unwrap();
    std::fs::remove_file(path).unwrap();
}
