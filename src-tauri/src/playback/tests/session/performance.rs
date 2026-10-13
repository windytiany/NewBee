use super::*;
use std::time::Instant;

#[test]
fn measures_large_queue_metadata_publication_persistence_and_preparation() {
    let count = 5000_usize;
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
    let database = crate::database::Database::open(":memory:").unwrap();
    {
        let mut connection = database.connection().unwrap();
        let transaction = connection.transaction().unwrap();
        for id in 1..=count as i64 {
            transaction.execute("INSERT INTO tracks (id, path, title, artist, album, duration_ms) VALUES (?1, ?2, ?3, 'Artist', 'Album', 1000)", rusqlite::params![id, format!("/missing/{id}.flac"), format!("Confirmed {id}")]).unwrap();
        }
        transaction.commit().unwrap();
    }
    let audio = Arc::new(Mutex::new(FakeAudio::default()));
    let worker_audio = audio.clone();
    let worker_path = path.clone();
    let observed = Arc::new(Mutex::new((0_usize, 0_usize)));
    let worker_observed = observed.clone();
    let deltas = Arc::new(Mutex::new((0_usize, 0_usize, 0_usize)));
    let worker_deltas = deltas.clone();
    let worker = std::thread::spawn(move || {
        run_worker(
            worker_audio,
            worker_path,
            generation,
            busy,
            receiver,
            |snapshot| {
                let bytes = serde_json::to_vec(snapshot).unwrap().len();
                let mut observed = worker_observed.lock().unwrap();
                observed.0 += 1;
                observed.1 += bytes;
            },
            |delta| {
                let bytes = serde_json::to_vec(delta).unwrap().len();
                let mut observed = worker_deltas.lock().unwrap();
                observed.0 += 1;
                observed.1 += bytes;
                observed.2 = observed.2.max(delta.displayed_tracks.len());
            },
        );
    });
    let start = Instant::now();
    let reply = handle
        .request(SessionCommand::PlayTracks {
            tracks: rows(&(1..=count as i64).collect::<Vec<_>>()),
            start_row_key: "row:0".into(),
            allow_skipped: true,
        })
        .unwrap()
        .recv_timeout(Duration::from_secs(30))
        .unwrap()
        .unwrap();
    let adding_elapsed = start.elapsed();
    assert_eq!(reply.snapshot.displayed_tracks.len(), count);
    audio.lock().unwrap().database = Some(database);
    let preparations_before = audio.lock().unwrap().preparations.len();
    *observed.lock().unwrap() = (0, 0);
    let mut reply_bytes = 0;
    let original_modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut persisted_bytes = 0;
    let mut persisted_changes = 0;
    let mut previous = std::fs::read(&path).unwrap();
    let start = Instant::now();
    for batch in (1..=count as i64).collect::<Vec<_>>().chunks(16) {
        let reply = handle
            .metadata(
                batch
                    .iter()
                    .map(|id| MetadataUpdate {
                        id: Some(*id),
                        path: None,
                        title: Some(format!("Stale {id}")),
                        artist: Some("Artist".into()),
                        album: Some("Album".into()),
                        duration_ms: Some(1000),
                    })
                    .collect(),
            )
            .unwrap()
            .recv_timeout(Duration::from_secs(30))
            .unwrap()
            .unwrap();
        let reply = reply.unwrap();
        assert_eq!(reply.displayed_tracks.len(), batch.len());
        reply_bytes += serde_json::to_vec(&reply).unwrap().len();
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            original_modified
        );
        let bytes = std::fs::read(&path).unwrap();
        if bytes != previous {
            persisted_changes += 1;
            persisted_bytes += bytes.len();
            previous = bytes;
        }
    }
    let metadata_elapsed = start.elapsed();

    let observed = observed.lock().unwrap();
    let preparations_after = audio.lock().unwrap().preparations.len();
    let snapshot = handle
        .request(SessionCommand::Snapshot)
        .unwrap()
        .recv()
        .unwrap()
        .unwrap()
        .snapshot;
    assert!(snapshot.displayed_tracks.iter().all(|track| track
        .title
        .as_ref()
        .is_some_and(|title| title.starts_with("Confirmed "))));
    let (_, saved) = SessionPersistence::load(path);
    assert!(saved.queue.displayed_tracks.iter().all(|track| track
        .title
        .as_ref()
        .is_some_and(|title| title.starts_with("Track "))));
    assert_eq!(saved.queue.displayed_tracks.len(), count);
    assert_eq!(audio.lock().unwrap().starts, [1]);
    assert_eq!(persisted_changes, 0);
    assert_eq!(observed.0, 0);
    let deltas = deltas.lock().unwrap();
    assert_eq!(deltas.0, count.div_ceil(16));
    assert_eq!(deltas.2, 16);
    assert_eq!(preparations_before, preparations_after);
    eprintln!(
        "B delta_publications={} delta_bytes={} reply_bytes={} max_delta_rows={}",
        deltas.0, deltas.1, reply_bytes, deltas.2
    );
    drop(handle);
    worker.join().unwrap();
    let database = audio.lock().unwrap().database.take().unwrap();
    let restored = Session::new(
        FakeAudio {
            database: Some(database),
            ..FakeAudio::default()
        },
        saved,
        Arc::new(AtomicU64::new(0)),
    );
    assert_eq!(restored.audio.metadata_reads.load(Ordering::SeqCst), 1);
    assert_eq!(restored.queue.displayed_tracks.len(), count);
    assert!(restored.queue.displayed_tracks.iter().all(|row| row
        .title
        .as_ref()
        .is_some_and(|title| title.starts_with("Confirmed "))));
    assert_eq!(
        restored.current_track.as_ref().unwrap().title.as_deref(),
        Some("Confirmed 1")
    );
    assert!(restored.audio.decoder_attempts.is_empty());
    assert!(restored.audio.starts.is_empty());
    eprintln!("B queue={count} add_ms={:.2} metadata_ms={:.2} metadata_commands={} full_publications={} published_bytes={} persisted_changes={} persisted_bytes={} preparations_before={} preparations_after={}",
        adding_elapsed.as_secs_f64() * 1000.0, metadata_elapsed.as_secs_f64() * 1000.0,
        count.div_ceil(16), observed.0, observed.1, persisted_changes, persisted_bytes,
        preparations_before, preparations_after);
}

#[test]
fn measures_candidate_and_snapshot_construction() {
    for count in [1000_usize, 5000] {
        let mut probe = fixture();
        play(&mut probe, &(1..=count as i64).collect::<Vec<_>>(), 0);
        let start = Instant::now();
        for _ in 0..10 {
            assert_eq!(
                probe.queue.candidates(false, false, &HashSet::new()).len(),
                count - 1
            );
        }
        let candidate_elapsed = start.elapsed();
        let start = Instant::now();
        for _ in 0..10 {
            assert_eq!(probe.snapshot().unwrap().displayed_tracks.len(), count);
        }
        let snapshot_elapsed = start.elapsed();
        eprintln!(
            "B queue={count} candidates_10_ms={:.2} snapshots_10_ms={:.2}",
            candidate_elapsed.as_secs_f64() * 1000.0,
            snapshot_elapsed.as_secs_f64() * 1000.0
        );
    }
}
