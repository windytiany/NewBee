use super::*;

fn update(id: i64) -> MetadataUpdate {
    MetadataUpdate {
        id: Some(id),
        path: None,
        title: Some("Confirmed".into()),
        artist: Some("Confirmed artist".into()),
        album: Some("Confirmed album".into()),
        duration_ms: Some(900),
    }
}

#[test]
fn metadata_patches_duplicate_rows_and_current_without_changing_session_semantics() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 1], 0);
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    session.queue_errors.push("prior queue error".into());
    session.playback_error = "prior playback error".into();
    let before = serde_json::to_value(session.saved()).unwrap();
    let preparations = session.audio.preparations.clone();
    let delta = session.update_metadata(vec![update(1)]).unwrap();
    assert_eq!(
        delta
            .displayed_tracks
            .iter()
            .map(|row| row.row_key.as_str())
            .collect::<Vec<_>>(),
        ["row:0", "row:2"]
    );
    assert!(delta
        .displayed_tracks
        .iter()
        .all(|row| row.title.as_deref() == Some("Confirmed")));
    assert_eq!(
        delta.current_track.unwrap().artist.as_deref(),
        Some("Confirmed artist")
    );
    assert_eq!(
        session.current_track.as_ref().unwrap().title.as_deref(),
        Some("Confirmed")
    );
    assert_eq!(session.audio.preparations, preparations);
    assert!(!session.command_pending);
    assert_eq!(session.queue_errors, ["prior queue error"]);
    assert_eq!(session.playback_error, "prior playback error");
    let after = serde_json::to_value(session.saved()).unwrap();
    let mut expected = before;
    for index in [0, 2] {
        expected["queue"]["displayedTracks"][index]["title"] = "Confirmed".into();
        expected["queue"]["displayedTracks"][index]["album"] = "Confirmed album".into();
        expected["queue"]["displayedTracks"][index]["durationMs"] = 900.into();
    }
    expected["currentTrack"]["title"] = "Confirmed".into();
    expected["currentTrack"]["artist"] = "Confirmed artist".into();
    assert_eq!(after, expected);
    let revision = session.revision;
    assert!(session
        .update_metadata(vec![update(1), update(999)])
        .is_none());
    assert_eq!(session.revision, revision);
    assert_eq!(session.structural_revision, delta.structural_revision);
}

#[test]
fn hydration_failure_retains_saved_rows_current_volume_and_surfaces_error() {
    let saved = SavedSession {
        queue: Queue::with_tracks(rows(&[1, 1, 2])),
        current_track: Some(ListeningTrack {
            track_id: Some(1),
            path: None,
            title: Some("Saved".into()),
            artist: Some("Saved artist".into()),
        }),
        volume: VolumePreferences {
            volume: 75,
            last_non_muted_volume: 75,
        },
    };
    let session = Session::new(
        FakeAudio {
            metadata_failure: true,
            ..FakeAudio::default()
        },
        saved,
        Arc::new(AtomicU64::new(0)),
    );
    assert_eq!(ids(&session), [1, 1, 2]);
    assert_eq!(
        session.current_track.as_ref().unwrap().title.as_deref(),
        Some("Saved")
    );
    assert_eq!(session.volume.volume, 75);
    assert_eq!(session.playback_error, "metadata unavailable");
    assert!(session.audio.starts.is_empty());
}

#[test]
fn worker_metadata_failure_and_no_matches_do_not_publish_persist_or_hide_errors() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.json");
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
    let (published, events) = mpsc::channel();
    let full = published.clone();
    let worker = std::thread::spawn(move || {
        run_worker(
            worker_audio,
            worker_path,
            generation,
            busy,
            receiver,
            |_| {
                full.send("full").unwrap();
            },
            |_| {
                published.send("delta").unwrap();
            },
        )
    });
    handle
        .request(SessionCommand::PlayTracks {
            tracks: rows(&[1, 1, 2]),
            start_row_key: "row:0".into(),
            allow_skipped: true,
        })
        .unwrap()
        .recv()
        .unwrap()
        .unwrap();
    while events.try_recv().is_ok() {}
    let bytes = std::fs::read(&path).unwrap();
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    assert!(handle
        .metadata(vec![update(999)])
        .unwrap()
        .recv()
        .unwrap()
        .unwrap()
        .is_none());
    let database = crate::database::Database::open(":memory:").unwrap();
    database.connection().unwrap().execute("INSERT INTO tracks (id, path, title, artist, album, duration_ms) VALUES (1, '/missing/1.flac', 'Confirmed', 'Confirmed artist', 'Confirmed album', 900)", []).unwrap();
    audio.lock().unwrap().database = Some(database);
    let delta = handle
        .metadata(vec![update(1)])
        .unwrap()
        .recv()
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(delta.displayed_tracks.len(), 2);
    assert_eq!(
        delta.current_track.unwrap().artist.as_deref(),
        Some("Confirmed artist")
    );
    assert_eq!(events.recv().unwrap(), "delta");
    assert!(handle
        .metadata(vec![update(1)])
        .unwrap()
        .recv()
        .unwrap()
        .unwrap()
        .is_none());
    let progress = handle.progress().unwrap().recv().unwrap().unwrap();
    assert_eq!(progress.revision, delta.revision);
    assert_eq!(progress.structural_revision, delta.structural_revision);
    audio.lock().unwrap().metadata_failure = true;
    assert_eq!(
        handle
            .metadata(vec![update(1)])
            .unwrap()
            .recv()
            .unwrap()
            .err()
            .unwrap(),
        "metadata unavailable"
    );
    assert!(events.try_recv().is_err());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        modified
    );
    assert!(!handle.busy.load(Ordering::SeqCst));
    drop(handle);
    worker.join().unwrap();
}

#[test]
fn recovery_hydrates_duplicates_and_detached_current_once_without_dropping_missing_db_ids() {
    let database = crate::database::Database::open(":memory:").unwrap();
    database.connection().unwrap().execute("INSERT INTO tracks (id, path, title, artist, album, duration_ms) VALUES (1, '/does/not/exist.flac', 'Hydrated', 'Hydrated artist', 'Hydrated album', 123)", []).unwrap();
    let mut queue = Queue::with_tracks(rows(&[1, 2, 1]));
    queue.commit("row:1", false);
    queue.shuffle_enabled = true;
    queue.repeat_one_enabled = true;
    let original_queue = serde_json::to_value(&queue).unwrap();
    let saved = SavedSession {
        queue,
        current_track: Some(ListeningTrack {
            track_id: Some(1),
            path: None,
            title: None,
            artist: None,
        }),
        volume: VolumePreferences {
            volume: 0,
            last_non_muted_volume: 75,
        },
    };
    let session = Session::new(
        FakeAudio {
            database: Some(database),
            ..FakeAudio::default()
        },
        saved,
        Arc::new(AtomicU64::new(0)),
    );
    assert_eq!(session.audio.metadata_reads.load(Ordering::SeqCst), 1);
    assert_eq!(ids(&session), [1, 2, 1]);
    assert_eq!(
        session.queue.displayed_tracks[1].title.as_deref(),
        Some("Track 2")
    );
    assert_eq!(
        session.current_track.as_ref().unwrap().title.as_deref(),
        Some("Hydrated")
    );
    assert_eq!(
        session.current_track.as_ref().unwrap().artist.as_deref(),
        Some("Hydrated artist")
    );
    assert!(session.audio.starts.is_empty());
    assert!(session.audio.decoder_attempts.is_empty());
    assert!(session.audio.preparations.is_empty());
    assert_eq!(session.volume.volume, 0);
    assert_eq!(session.volume.last_non_muted_volume, 75);
    let mut expected = original_queue;
    for index in [0, 2] {
        expected["displayedTracks"][index]["title"] = "Hydrated".into();
        expected["displayedTracks"][index]["album"] = "Hydrated album".into();
        expected["displayedTracks"][index]["durationMs"] = 123.into();
    }
    assert_eq!(serde_json::to_value(&session.queue).unwrap(), expected);
    let backup = session.saved();
    assert_eq!(
        backup.current_track.unwrap().title.as_deref(),
        Some("Hydrated")
    );
}
