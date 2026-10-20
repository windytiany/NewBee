use super::*;

#[test]
fn end_advances_without_frontend_polling_and_only_has_ended_drives_progression() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 0);
    session.audio.position = 100;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1]);
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2]);
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2, 3]);
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.position, 0);
    assert!(!session.audio.playing);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:2"));
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2, 3]);
}

#[test]
fn gapless_boundaries_are_adopted_and_prepare_the_next_successor_without_manual_start() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 0);
    assert_eq!(session.prepared.as_ref().unwrap().1, "row:1");
    boundary(&mut session, "row:1");
    session.tick().unwrap();
    assert_eq!(current(&session), Some(2));
    assert_eq!(session.playback_id, Some(2));
    assert_eq!(session.prepared.as_ref().unwrap().1, "row:2");
    boundary(&mut session, "row:2");
    session.tick().unwrap();
    assert_eq!(current(&session), Some(3));
    assert_eq!(session.audio.starts, [1]);
    assert!(session.prepared.is_none());
}

#[test]
fn preserves_ready_successor_when_only_tail_changes() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    let count = session.audio.preparations.len();
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: rows(&[3]),
            next: false,
        },
    );
    assert_eq!(session.audio.preparations.len(), count);
    assert_eq!(session.prepared.as_ref().unwrap().1, "row:1");
}

#[test]
fn inserting_next_replaces_prepared_successor_and_missing_file_does_not_interrupt_current_audio() {
    let mut session = fixture();
    session.audio.failed.insert(2);
    play(&mut session, &[1, 2, 3], 0);
    assert_eq!(session.prepared.as_ref().unwrap().1, "row:2");
    assert_eq!(current(&session), Some(1));
    assert!(session.queue_errors.join("\n").contains("missing file"));
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: rows(&[4]),
            next: true,
        },
    );
    assert_eq!(
        session
            .queue
            .find(&session.prepared.as_ref().unwrap().1)
            .unwrap()
            .track_id,
        Some(4)
    );
    assert_eq!(session.audio.starts, [1]);
}

#[test]
fn repeat_one_prepares_same_row_but_manual_next_ignores_repeat() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    assert_eq!(session.prepared.as_ref().unwrap().1, "row:0");
    boundary(&mut session, "row:0");
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1]);
    assert!(!session.snapshot().unwrap().can_play_previous);
    execute(&mut session, SessionCommand::Next);
    assert_eq!(session.audio.starts, [1, 2]);
}

#[test]
fn repeat_failure_advances_and_reports_failure_without_wrapping() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    session.audio.failed.insert(1);
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 1, 2]);
    assert!(session.queue_errors.join("\n").contains("Track 1"));
}

#[test]
fn live_skip_flags_filter_random_and_sequential_candidates_not_display_rows() {
    for shuffle in [false, true] {
        let mut session = fixture();
        session.audio.skipped.extend([2, 3]);
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        play(&mut session, &[1, 2, 2, 3, 4], 0);
        assert_eq!(ids(&session), [1, 2, 2, 3, 4]);
        assert_eq!(
            session
                .queue
                .candidates(false, true, &session.skipped)
                .iter()
                .filter_map(|track| track.track_id)
                .collect::<Vec<_>>(),
            [4]
        );
        session.audio.ended = true;
        session.tick().unwrap();
        assert_eq!(session.audio.starts, [1, 4]);
        assert!(session.queue_errors.is_empty());
    }
}

#[test]
fn unskip_is_live_and_explicit_flagged_selection_never_clears_flag_or_repeats_it() {
    for shuffle in [false, true] {
        let mut session = fixture();
        session.audio.skipped.insert(2);
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        execute(&mut session, SessionCommand::Repeat { enabled: true });
        play(&mut session, &[1, 2, 3], 1);
        assert_eq!(session.audio.starts, [2]);
        session.audio.ended = true;
        session.tick().unwrap();
        assert_eq!(session.audio.starts, [2, 3]);
        assert!(session.audio.skipped.contains(&2));
        execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "row:1".into(),
            },
        );
        assert_eq!(session.audio.starts, [2, 3, 2]);
        session.audio.skipped.remove(&2);
        session.tick().unwrap();
        assert_eq!(session.prepared.as_ref().unwrap().1, "row:1");
    }
}

#[test]
fn entirely_skipped_replacement_is_retained_and_stops_previous_audio() {
    let mut session = fixture();
    play(&mut session, &[9], 0);
    session.audio.skipped.extend([1, 2]);
    let applied = execute(
        &mut session,
        SessionCommand::PlayTracks {
            tracks: rows(&[1, 2]),
            start_row_key: Some("row:0".into()),
            allow_skipped: false,
        },
    )
    .0;
    assert!(!applied);
    assert_eq!(ids(&session), [1, 2]);
    assert_eq!(session.audio.starts, [9]);
    assert_eq!(session.audio.stops, [1]);
    assert!(session.playback_id.is_none());
    assert!(!session.snapshot().unwrap().can_play_next);
}

#[test]
fn album_start_skips_first_flagged_row_and_flagging_current_never_truncates_it() {
    let mut session = fixture();
    session.audio.skipped.insert(1);
    execute(
        &mut session,
        SessionCommand::PlayTracks {
            tracks: rows(&[1, 2, 3]),
            start_row_key: Some("row:0".into()),
            allow_skipped: false,
        },
    );
    assert_eq!(session.audio.starts, [2]);
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    session.audio.skipped.extend([2, 3]);
    session.tick().unwrap();
    assert!(session.audio.stops.is_empty());
    assert!(session.prepared.is_none());
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [2]);
    assert!(!session.audio.playing);
    assert_eq!(session.audio.position, 0);
    assert_eq!(ids(&session), [1, 2, 3]);
}

#[test]
fn skip_changes_after_audio_boundary_do_not_reject_adoption() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 0);
    boundary(&mut session, "row:1");
    session.audio.skipped.insert(2);
    session.tick().unwrap();
    assert_eq!(current(&session), Some(2));
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:1"));
    assert_eq!(session.audio.starts, [1]);
}

#[test]
fn skips_flags_changed_during_start_and_releases_cancelled_audio() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 0);
    session.audio.skip_on_start = Some(2);
    execute(&mut session, SessionCommand::Next);
    assert_eq!(session.audio.starts, [1, 2, 3]);
    assert_eq!(session.audio.stops, [2]);
    assert_eq!(current(&session), Some(3));
    assert!(session.queue_errors.is_empty());
}

#[test]
fn skipped_added_rows_are_not_started_and_previous_uses_live_flags() {
    for shuffle in [false, true] {
        let mut session = fixture();
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        play(&mut session, &[1, 2], 0);
        session.audio.skipped.insert(4);
        execute(
            &mut session,
            SessionCommand::Add {
                tracks: rows(&[4]),
                next: true,
            },
        );
        execute(
            &mut session,
            SessionCommand::Add {
                tracks: rows(&[4]),
                next: false,
            },
        );
        execute(&mut session, SessionCommand::Next);
        assert_eq!(session.audio.starts, [1, 2]);
        assert_eq!(ids(&session).len(), 4);
        session.audio.skipped.insert(1);
        session.tick().unwrap();
        assert!(!session.snapshot().unwrap().can_play_previous);
        session.audio.skipped.remove(&1);
        execute(&mut session, SessionCommand::Previous);
        assert_eq!(session.audio.starts, [1, 2, 1]);
    }
}

#[test]
fn newer_intent_invalidates_pending_decode_before_commit_and_never_rewinds_newer_track() {
    let mut session = fixture();
    session.audio.invalidate_on_start = Some(session.generation.clone());
    assert!(!play(&mut session, &[1, 2], 0));
    assert_eq!(session.audio.starts, [1]);
    assert_eq!(session.audio.stops, [1]);
    assert!(session.current_track.is_none());
    assert!(play(&mut session, &[3], 0));
    session.audio.ended = true;
    session.generation.fetch_add(1, Ordering::SeqCst);
    assert!(!session.execute(SessionCommand::Next, 1).unwrap().0);
    assert_eq!(current(&session), Some(3));
    assert_eq!(session.audio.starts, [1, 3]);
}

#[test]
fn late_automatic_start_retries_target_for_latest_manual_intent() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    session.audio.ended = true;
    session.audio.invalidate_on_start = Some(session.generation.clone());
    session.tick().unwrap();
    assert_eq!(session.audio.stops, [2]);
    execute(&mut session, SessionCommand::Next);
    assert_eq!(session.audio.starts, [1, 2, 2]);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:1"));
}

#[test]
fn pause_and_seeking_suppress_stale_end_and_seek_only_targets_expected_instance() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    session.audio.ended = true;
    execute(&mut session, SessionCommand::Pause);
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1]);
    execute(&mut session, SessionCommand::BeginSeeking);
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1]);
    assert!(
        execute(
            &mut session,
            SessionCommand::Seek {
                position_ms: 100,
                playback_id: Some(1)
            }
        )
        .0
    );
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2]);
    assert!(
        !execute(
            &mut session,
            SessionCommand::Seek {
                position_ms: 0,
                playback_id: Some(1)
            }
        )
        .0
    );
    assert_eq!(current(&session), Some(2));
}

#[test]
fn explicit_system_play_pause_are_idempotent_and_toggle_uses_same_session() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    execute(&mut session, SessionCommand::Play);
    assert!(session.audio.playing);
    execute(&mut session, SessionCommand::Pause);
    execute(&mut session, SessionCommand::Pause);
    assert!(!session.audio.playing);
    execute(&mut session, SessionCommand::Toggle);
    assert!(session.audio.playing);
    execute(&mut session, SessionCommand::Next);
    execute(&mut session, SessionCommand::Previous);
    assert_eq!(session.audio.starts, [1, 2, 1]);
    session.audio.status_failure = true;
    assert!(session
        .execute(
            SessionCommand::Toggle,
            session.generation.load(Ordering::SeqCst)
        )
        .is_err());
    assert!(session.audio.playing);
}

#[test]
fn stale_seek_never_cancels_a_newer_decode_intent() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    execute(&mut session, SessionCommand::BeginSeeking);
    let old_generation = session.generation.load(Ordering::SeqCst);
    session.generation.fetch_add(1, Ordering::SeqCst);
    assert!(
        !session
            .execute(
                SessionCommand::Seek {
                    position_ms: 100,
                    playback_id: Some(1)
                },
                old_generation
            )
            .unwrap()
            .0
    );
    execute(
        &mut session,
        SessionCommand::PlayItem {
            row_key: "row:1".into(),
        },
    );
    assert_eq!(session.audio.starts, [1, 2]);
    assert!(
        !execute(
            &mut session,
            SessionCommand::Seek {
                position_ms: 100,
                playback_id: Some(1)
            }
        )
        .0
    );
    assert_eq!(current(&session), Some(2));
}

#[test]
fn registered_file_metadata_updates_only_matching_id_without_touching_other_rows() {
    let mut session = fixture();
    let path = std::env::temp_dir()
        .join("audition.wav")
        .to_string_lossy()
        .into_owned();
    let mut tracks = rows(&[1, 1, 2]);
    let file = &mut tracks[1];
    file.track_id = None;
    file.path = Some(path.clone());
    let other = &mut tracks[2];
    other.track_id = None;
    other.path = Some(
        std::env::temp_dir()
            .join("other.wav")
            .to_string_lossy()
            .into_owned(),
    );
    execute(
        &mut session,
        SessionCommand::PlayTracks {
            tracks,
            start_row_key: Some("row:1".into()),
            allow_skipped: true,
        },
    );
    let id = session.queue.displayed_tracks[1].track_id.unwrap();
    let database = crate::database::Database::open(":memory:").unwrap();
    database.connection().unwrap().execute(
        "INSERT INTO tracks (id, path, title, artist, album, duration_ms) VALUES (?1, ?2, 'File title', 'File artist', 'File album', 500)",
        rusqlite::params![id, path],
    ).unwrap();
    session.audio.database = Some(database);
    let update = serde_json::from_value(serde_json::json!({ "id": id, "title": "Stale title", "artist": null, "album": null, "durationMs": null })).unwrap();
    session.refresh_metadata(vec![update]).unwrap();
    assert_eq!(
        session.queue.displayed_tracks[0].title.as_deref(),
        Some("Track 1")
    );
    assert_eq!(
        session.queue.displayed_tracks[1].title.as_deref(),
        Some("File title")
    );
    assert_eq!(
        session.queue.displayed_tracks[2].title.as_deref(),
        Some("Track 2")
    );
    assert_eq!(
        session.current_track.as_ref().unwrap().title.as_deref(),
        Some("File title")
    );
    assert_eq!(session.current_track.as_ref().unwrap().track_id, Some(id));
    assert!(session
        .queue
        .displayed_tracks
        .iter()
        .all(|track| track.path.is_none()));
}
