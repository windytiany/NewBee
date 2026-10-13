use super::*;

#[test]
fn ready_successor_after_failure_survives_tail_changes_without_retrying_bad_row() {
    let mut session = fixture();
    session.audio.failed.insert(2);
    play(&mut session, &[1, 2, 3], 0);
    let preparations = session.audio.preparations.clone();
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: rows(&[4]),
            next: false,
        },
    );
    assert_eq!(session.audio.preparations, preparations);
    assert_eq!(session.prepared.as_ref().unwrap().1, "row:2");
    assert_eq!(session.audio.starts, [1]);
}

#[test]
fn automatic_failures_are_bounded_by_rows_with_duplicates_repeat_shuffle_and_skip() {
    for shuffle in [false, true] {
        let mut session = fixture();
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        play(&mut session, &[1, 2, 2, 3], 0);
        session.audio.failed.extend([1, 2]);
        session.audio.skipped.insert(3);
        execute(&mut session, SessionCommand::Repeat { enabled: true });
        session.audio.ended = true;
        session.tick().unwrap();
        assert_eq!(session.audio.starts, [1, 1, 2, 2]);
        assert!(!session.audio.playing);
        assert_eq!(ids(&session), [1, 2, 2, 3]);
        let preparations = session.audio.preparations.clone();
        for _ in 0..100 {
            session.tick().unwrap();
        }
        assert_eq!(session.audio.starts, [1, 1, 2, 2]);
        assert_eq!(session.audio.preparations, preparations);
        assert!(session
            .snapshot()
            .unwrap()
            .queue_playback_error
            .contains("missing file"));
    }
}

#[test]
fn automatic_end_skips_failed_rows_to_good_and_manual_failure_can_retry() {
    let mut session = fixture();
    session.audio.failed.insert(2);
    play(&mut session, &[1, 2, 2, 3], 0);
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2, 2, 3]);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:3"));
    let retained = session.queue.displayed_tracks.clone();
    assert!(
        !execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "row:1".into()
            }
        )
        .0
    );
    assert_eq!(session.queue.displayed_tracks, retained);
    assert_eq!(current(&session), Some(3));
    assert!(session
        .snapshot()
        .unwrap()
        .queue_playback_error
        .contains("missing file"));
    session.audio.failed.remove(&2);
    assert!(
        execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "row:1".into()
            }
        )
        .0
    );
    assert_eq!(current(&session), Some(2));
}

#[test]
fn disconnected_restored_current_reports_failure_without_advancing_or_dropping_rows() {
    let mut queue = Queue::with_tracks(rows(&[7, 7, 8]));
    queue.current_row_key = Some("row:0".into());
    let mut audio = FakeAudio::default();
    audio.failed.insert(7);
    let mut session = Session::new(
        audio,
        SavedSession {
            queue,
            ..SavedSession::default()
        },
        Arc::new(AtomicU64::new(0)),
    );
    assert!(session.audio.starts.is_empty());
    assert!(!execute(&mut session, SessionCommand::Toggle).0);
    assert_eq!(session.audio.starts, [7]);
    assert_eq!(ids(&session), [7, 7, 8]);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:0"));
    for _ in 0..100 {
        session.tick().unwrap();
    }
    assert_eq!(session.audio.starts, [7]);
}

#[test]
fn decode_failure_is_row_scoped_and_duplicate_track_can_succeed_in_another_row() {
    for shuffle in [false, true] {
        let mut session = fixture();
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        session.audio.row_failures.insert(
            "row:1".into(),
            "Could not decode audio file: fixture failure".into(),
        );
        play(&mut session, &[1, 7, 7], 0);
        assert_eq!(session.prepared.as_ref().unwrap().1, "row:2");
        session.audio.ended = true;
        session.tick().unwrap();
        assert_eq!(current(&session), Some(7));
        assert_eq!(session.queue.current_row_key.as_deref(), Some("row:2"));
        assert_eq!(ids(&session), [1, 7, 7]);
        assert!(session
            .snapshot()
            .unwrap()
            .queue_playback_error
            .contains("decode"));
        assert_eq!(
            session.audio.start_rows.first().map(String::as_str),
            Some("row:0")
        );
        assert_eq!(
            session.audio.start_rows.last().map(String::as_str),
            Some("row:2")
        );
        assert!(
            session
                .audio
                .start_rows
                .iter()
                .filter(|row| *row == "row:1")
                .count()
                <= 1
        );
    }
}

#[test]
fn initial_manual_decode_failure_keeps_registered_rows_and_can_be_retried() {
    let mut session = fixture();
    session.audio.row_failures.insert(
        "row:0".into(),
        "Could not decode audio file: fixture failure".into(),
    );
    assert!(!play(&mut session, &[7, 7, 8], 0));
    assert_eq!(session.audio.starts, [7]);
    assert_eq!(ids(&session), [7, 7, 8]);
    assert!(session.playback_id.is_none());
    assert!(!session.audio.playing);
    session.audio.row_failures.clear();
    assert!(
        execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "row:0".into()
            }
        )
        .0
    );
    assert_eq!(session.audio.starts, [7, 7]);
}
