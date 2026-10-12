use super::*;

fn temporary_path() -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("newbee-session-{unique}.json"))
}

#[test]
fn persistence_round_trips_duplicates_modes_selection_and_explicit_next_priority_without_autoplay()
{
    let path = temporary_path();
    let mut session = fixture();
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    play(&mut session, &[7, 7, 8], 1);
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: rows(&[9, 9]),
            next: true,
        },
    );
    let (mut persistence, _) = SessionPersistence::load(path.clone());
    persistence.save(&session.saved()).unwrap();
    let (_, saved) = SessionPersistence::load(path.clone());
    let mut restored = Session::new(FakeAudio::default(), saved, Arc::new(AtomicU64::new(0)));
    assert_eq!(ids(&restored), [7, 7, 9, 9, 8]);
    assert_eq!(restored.queue.current_row_key.as_deref(), Some("row:1"));
    assert!(restored.queue.shuffle_enabled && restored.queue.repeat_one_enabled);
    assert!(restored.audio.starts.is_empty());
    assert!(restored.playback_id.is_none());
    assert_eq!(
        restored
            .queue
            .candidates(false, false, &HashSet::new())
            .iter()
            .filter_map(|track| track.track_id)
            .collect::<Vec<_>>(),
        [9, 9, 8]
    );
    execute(&mut restored, SessionCommand::Toggle);
    assert_eq!(restored.audio.starts, [7]);
    execute(
        &mut restored,
        SessionCommand::Add {
            tracks: rows(&[9]),
            next: false,
        },
    );
    let keys: HashSet<_> = restored
        .queue
        .displayed_tracks
        .iter()
        .map(|track| &track.row_key)
        .collect();
    assert_eq!(keys.len(), 6);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn persists_natural_transitions_and_removal_and_excludes_runtime_fields() {
    let path = temporary_path();
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 0);
    boundary(&mut session, "row:1");
    session.tick().unwrap();
    execute(&mut session, SessionCommand::RemoveTrack { track_id: 1 });
    let (mut persistence, _) = SessionPersistence::load(path.clone());
    persistence.save(&session.saved()).unwrap();
    let serialized = std::fs::read_to_string(&path).unwrap();
    assert!(!serialized.contains("playbackId"));
    assert!(!serialized.contains("history"));
    assert!(!serialized.contains("remaining"));
    assert!(!serialized.contains("editing"));
    let (_, saved) = SessionPersistence::load(path.clone());
    assert_eq!(
        saved
            .queue
            .displayed_tracks
            .iter()
            .filter_map(|track| track.track_id)
            .collect::<Vec<_>>(),
        [2, 3]
    );
    assert_eq!(saved.queue.current_row_key.as_deref(), Some("row:1"));
    assert_eq!(saved.current_track.unwrap().track_id, Some(2));
    std::fs::remove_file(path).unwrap();
}

#[test]
fn corrupt_and_legacy_snapshots_restore_empty_and_invalid_priority_is_rejected() {
    let path = temporary_path();
    for serialized in ["not json", "{}", r#"{"version":2,"displayedTracks":[]}"#] {
        std::fs::write(&path, serialized).unwrap();
        let (_, saved) = SessionPersistence::load(path.clone());
        assert!(saved.queue.displayed_tracks.is_empty());
        assert!(saved.current_track.is_none());
    }
    let mut session = fixture();
    play(&mut session, &[1], 0);
    let mut saved = session.saved();
    saved.queue.next_row_keys.insert("missing".into());
    std::fs::write(&path, serde_json::to_string(&saved).unwrap()).unwrap();
    let (_, saved) = SessionPersistence::load(path.clone());
    assert!(saved.queue.displayed_tracks.is_empty());
    std::fs::remove_file(path).unwrap();
}

#[test]
fn persistence_failure_keeps_in_memory_session_playable_and_retries_unchanged_snapshot() {
    let path = temporary_path();
    std::fs::create_dir(&path).unwrap();
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    let (mut persistence, _) = SessionPersistence::load(path.clone());
    assert!(persistence.save(&session.saved()).is_err());
    assert_eq!(current(&session), Some(1));
    std::fs::remove_dir(&path).unwrap();
    persistence.save(&session.saved()).unwrap();
    execute(&mut session, SessionCommand::Next);
    assert_eq!(current(&session), Some(2));
    persistence.save(&session.saved()).unwrap();
    let (_, saved) = SessionPersistence::load(path.clone());
    assert_eq!(saved.queue.current_row_key.as_deref(), Some("row:1"));
    std::fs::remove_file(path).unwrap();
}

#[test]
fn valid_selection_restores_even_if_previous_current_track_is_different() {
    let mut queue = Queue::with_tracks(rows(&[11, 22, 33]));
    queue.current_row_key = Some("row:1".into());
    let saved = SavedSession {
        queue,
        volume: VolumePreferences::default(),
        current_track: Some(ListeningTrack {
            track_id: Some(999),
            path: None,
            title: None,
            artist: None,
        }),
    };
    let mut session = Session::new(FakeAudio::default(), saved, Arc::new(AtomicU64::new(0)));
    assert!(session.audio.starts.is_empty());
    assert_eq!(current(&session), Some(999));
    execute(&mut session, SessionCommand::Toggle);
    assert_eq!(session.audio.starts, [22]);
}
