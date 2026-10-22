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
            |_| {},
            (
                |snapshot| {
                    observed.send(snapshot.clone()).unwrap();
                },
                |_| {},
            ),
        )
    });
    let reply = handle
        .request(SessionCommand::PlayTracks {
            tracks: rows(&[1, 2, 3]),
            start_row_key: Some("row:0".into()),
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
