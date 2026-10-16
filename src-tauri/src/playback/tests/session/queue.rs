use super::*;

#[test]
fn sequential_navigation_starts_in_middle_and_does_not_wrap() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 1);
    assert!(session.snapshot().unwrap().can_play_previous);
    assert!(execute(&mut session, SessionCommand::Previous).0);
    assert_eq!(current(&session), Some(1));
    assert!(!session.snapshot().unwrap().can_play_previous);
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    execute(&mut session, SessionCommand::Next);
    execute(&mut session, SessionCommand::Next);
    assert_eq!(current(&session), Some(3));
    assert!(!session.snapshot().unwrap().can_play_next);
    assert!(!execute(&mut session, SessionCommand::Next).0);
    assert_eq!(session.audio.starts, [2, 1, 2, 3]);
    assert!(session.audio.stops.is_empty());
}

#[test]
fn duplicate_track_ids_are_distinguished_by_row_key_and_previous_skips_failures() {
    let mut session = fixture();
    session.audio.failed.insert(2);
    play(&mut session, &[7, 2, 7], 2);
    assert!(execute(&mut session, SessionCommand::Previous).0);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:0"));
    assert!(execute(&mut session, SessionCommand::Next).0);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:2"));
    assert_eq!(session.audio.starts, [7, 2, 7, 2, 7]);
    assert!(session.queue_errors.join("\n").contains("Track 2"));
    assert!(!session.snapshot().unwrap().can_play_next);
}

#[test]
fn whole_list_playback_uses_queue_order_and_consumes_every_row_once() {
    for shuffle in [false, true] {
        let mut session = fixture();
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        let command = serde_json::from_value(serde_json::json!({
            "action": "playTracks",
            "tracks": rows(&[1, 2, 3, 4, 5]),
            "startRowKey": null,
            "allowSkipped": false,
        }))
        .unwrap();
        assert!(execute(&mut session, command).0);
        assert_eq!(ids(&session), [1, 2, 3, 4, 5]);
        assert!(!session.snapshot().unwrap().can_play_previous);
        if !shuffle {
            assert_eq!(current(&session), Some(1));
        }
        for _ in 0..4 {
            assert!(execute(&mut session, SessionCommand::Next).0);
        }
        assert!(!session.snapshot().unwrap().can_play_next);
        assert_eq!(session.audio.starts.len(), 5);
        let mut visited = session.audio.starts.clone();
        visited.sort_unstable();
        assert_eq!(visited, [1, 2, 3, 4, 5]);
    }
}

#[test]
fn whole_list_playback_excludes_skipped_rows_and_advances_past_failures() {
    for shuffle in [false, true] {
        let mut session = fixture();
        session.audio.skipped.extend([1, 2]);
        session.audio.failed.insert(3);
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        assert!(
            execute(
                &mut session,
                SessionCommand::PlayTracks {
                    tracks: rows(&[1, 2, 3, 4]),
                    start_row_key: None,
                    allow_skipped: false,
                },
            )
            .0
        );
        assert_eq!(current(&session), Some(4));
        assert!(session.audio.starts.iter().all(|id| *id == 3 || *id == 4));
    }
}

#[test]
fn shuffle_uses_successful_history_and_consumes_each_pending_row_once() {
    let mut session = fixture();
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    play(&mut session, &[1, 2, 3, 4, 5], 0);
    execute(&mut session, SessionCommand::Next);
    let second = current(&session);
    execute(&mut session, SessionCommand::Next);
    let third = current(&session);
    execute(&mut session, SessionCommand::Previous);
    assert_eq!(current(&session), second);
    execute(&mut session, SessionCommand::Next);
    assert_eq!(current(&session), third);
    execute(&mut session, SessionCommand::Next);
    execute(&mut session, SessionCommand::Next);
    let mut visited = session.audio.starts.clone();
    visited.sort_unstable();
    visited.dedup();
    assert_eq!(visited, [1, 2, 3, 4, 5]);
    assert!(!session.snapshot().unwrap().can_play_next);
}

#[test]
fn disabling_shuffle_restores_queue_order_not_history() {
    let mut session = fixture();
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    play(&mut session, &[1, 2, 3], 1);
    assert!(!session.snapshot().unwrap().can_play_previous);
    execute(&mut session, SessionCommand::Shuffle { enabled: false });
    assert!(session.snapshot().unwrap().can_play_previous);
    execute(&mut session, SessionCommand::Previous);
    execute(&mut session, SessionCommand::Next);
    assert_eq!(session.audio.starts, [2, 1, 2]);
}

#[test]
fn batches_and_repeated_next_insertions_keep_visible_order_and_unique_keys() {
    for shuffle in [false, true] {
        let mut session = fixture();
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        play(&mut session, &[1, 2], 0);
        execute(
            &mut session,
            SessionCommand::Add {
                tracks: rows(&[3, 4]),
                next: true,
            },
        );
        execute(
            &mut session,
            SessionCommand::Add {
                tracks: rows(&[5]),
                next: true,
            },
        );
        assert_eq!(ids(&session), [1, 5, 3, 4, 2]);
        let keys: HashSet<_> = session
            .queue
            .displayed_tracks
            .iter()
            .map(|track| track.row_key.clone())
            .collect();
        assert_eq!(keys.len(), 5);
        assert_eq!(session.audio.starts, [1]);
        for _ in 0..4 {
            execute(&mut session, SessionCommand::Next);
        }
        assert_eq!(session.audio.starts, [1, 5, 3, 4, 2]);
    }
}

#[test]
fn repeated_appends_to_idle_queue_never_start_playback() {
    let mut session = fixture();
    for expected in [vec![1, 2], vec![1, 2, 1, 2]] {
        assert!(
            execute(
                &mut session,
                SessionCommand::Add {
                    tracks: rows(&[1, 2]),
                    next: false,
                },
            )
            .0
        );
        assert_eq!(ids(&session), expected);
        assert!(session.audio.starts.is_empty());
        assert!(session.audio.stops.is_empty());
        assert!(session.audio.preparations.is_empty());
        let snapshot = session.snapshot().unwrap();
        assert!(snapshot.current_playback_id.is_none());
        assert!(!snapshot.playback_status.is_playing);
        assert!(snapshot.playback_error.is_empty());
        assert!(snapshot.queue_playback_error.is_empty());
    }
}

#[test]
fn appended_batch_preserves_visible_order_without_interrupting() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: rows(&[3, 4, 5]),
            next: false,
        },
    );
    assert_eq!(ids(&session), [1, 2, 3, 4, 5]);
    assert_eq!(session.audio.starts, [1]);
    for _ in 0..4 {
        execute(&mut session, SessionCommand::Next);
    }
    assert_eq!(session.audio.starts, [1, 2, 3, 4, 5]);
}

#[test]
fn appended_shuffle_tail_joins_pending_candidates_without_losing_any_rows() {
    let mut session = fixture();
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    play(&mut session, &[1, 2, 3], 0);
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: rows(&[4]),
            next: false,
        },
    );
    assert_eq!(ids(&session), [1, 2, 3, 4]);
    assert_eq!(session.audio.starts, [1]);
    for _ in 0..3 {
        execute(&mut session, SessionCommand::Next);
    }
    let mut visited = session.audio.starts.clone();
    visited.sort_unstable();
    assert_eq!(visited, [1, 2, 3, 4]);
}

#[test]
fn next_insertions_precede_forward_history_after_previous_navigation() {
    for shuffle in [false, true] {
        let mut session = fixture();
        execute(&mut session, SessionCommand::Shuffle { enabled: shuffle });
        play(&mut session, &[1, 2, 3, 4], 0);
        execute(&mut session, SessionCommand::Next);
        let second = current(&session);
        execute(&mut session, SessionCommand::Next);
        let third = current(&session);
        execute(&mut session, SessionCommand::Previous);
        assert_eq!(current(&session), second);
        execute(
            &mut session,
            SessionCommand::Add {
                tracks: rows(&[5, 6]),
                next: true,
            },
        );
        execute(&mut session, SessionCommand::Next);
        assert_eq!(current(&session), Some(5));
        execute(&mut session, SessionCommand::Next);
        assert_eq!(current(&session), Some(6));
        execute(&mut session, SessionCommand::Next);
        assert_eq!(current(&session), third);
    }
}

#[test]
fn removes_all_duplicate_occurrences_and_stops_once_before_advancing() {
    let mut session = fixture();
    play(&mut session, &[7, 7, 8, 7], 0);
    let result = execute(&mut session, SessionCommand::RemoveTrack { track_id: 7 })
        .1
        .unwrap();
    assert!(matches!(result, RemovalResult::Removed));
    assert_eq!(ids(&session), [8]);
    assert_eq!(current(&session), Some(8));
    assert_eq!(session.audio.stops, [1]);
    assert_eq!(session.audio.starts, [7, 8]);
    assert!(matches!(
        execute(&mut session, SessionCommand::RemoveTrack { track_id: 7 }).1,
        Some(RemovalResult::NotFound)
    ));
}

#[test]
fn multi_row_removal_stops_once_and_advances_only_to_retained_successors() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3, 4], 0);
    execute(
        &mut session,
        SessionCommand::Remove {
            row_keys: vec!["row:0".into(), "row:1".into()],
        },
    );
    assert_eq!(ids(&session), [3, 4]);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:2"));
    assert_eq!(session.audio.stops, [1]);
    assert_eq!(session.audio.starts, [1, 3]);
}

#[test]
fn non_current_removal_neither_stops_nor_advances() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 0);
    execute(&mut session, SessionCommand::RemoveTrack { track_id: 2 });
    assert_eq!(ids(&session), [1, 3]);
    assert_eq!(current(&session), Some(1));
    assert!(session.audio.stops.is_empty());
    assert_eq!(session.audio.starts, [1]);
    assert_eq!(
        session.prepared.as_ref().map(|(_, key)| key.as_str()),
        Some("row:2")
    );
}

#[test]
fn removal_stop_failure_and_unconfirmed_stop_never_advance() {
    for stop_result in [Err("device busy".into()), Ok(false)] {
        let mut session = fixture();
        play(&mut session, &[1, 2, 3], 0);
        session.audio.stop_result = Some(stop_result.clone());
        let removal = execute(
            &mut session,
            SessionCommand::Remove {
                row_keys: vec!["row:0".into(), "row:1".into()],
            },
        )
        .1
        .unwrap();
        match stop_result {
            Err(_) => assert!(
                matches!(removal, RemovalResult::StopFailed { message } if message == "device busy")
            ),
            Ok(_) => assert!(matches!(removal, RemovalResult::StopUnconfirmed)),
        }
        assert_eq!(ids(&session), [3]);
        assert!(session.queue.current_row_key.is_none());
        assert_eq!(session.audio.starts, [1]);
    }
}

#[test]
fn removal_is_superseded_if_newer_intent_arrives_during_stop() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    session.audio.invalidate_on_stop = Some(session.generation.clone());
    assert!(matches!(
        execute(&mut session, SessionCommand::RemoveTrack { track_id: 1 }).1,
        Some(RemovalResult::Superseded)
    ));
    assert_eq!(session.audio.starts, [1]);
    execute(
        &mut session,
        SessionCommand::PlayItem {
            row_key: "row:1".into(),
        },
    );
    assert_eq!(session.audio.starts, [1, 2]);
}

#[test]
fn removal_prunes_history_and_explicit_play_starts_a_new_round() {
    let mut session = fixture();
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    play(&mut session, &[1, 2, 3, 4], 0);
    execute(&mut session, SessionCommand::Next);
    let removed_key = session.queue.current_row_key.clone().unwrap();
    execute(&mut session, SessionCommand::Next);
    execute(
        &mut session,
        SessionCommand::Remove {
            row_keys: vec![removed_key],
        },
    );
    execute(&mut session, SessionCommand::Previous);
    assert_eq!(current(&session), Some(1));
    let key = session
        .queue
        .displayed_tracks
        .last()
        .unwrap()
        .row_key
        .clone();
    execute(&mut session, SessionCommand::PlayItem { row_key: key });
    assert!(!session.snapshot().unwrap().can_play_previous);
    play(&mut session, &[10, 11], 0);
    assert_eq!(current(&session), Some(10));
    assert!(!session.snapshot().unwrap().can_play_previous);
}

#[test]
fn clear_stops_without_advancing_and_resets_modes() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    execute(&mut session, SessionCommand::Repeat { enabled: true });
    execute(&mut session, SessionCommand::Shuffle { enabled: true });
    execute(&mut session, SessionCommand::Clear);
    assert_eq!(session.audio.starts, [1]);
    assert_eq!(session.audio.stops, [1]);
    assert!(session.queue.displayed_tracks.is_empty());
    assert!(session.current_track.is_none());
    assert!(!session.queue.shuffle_enabled && !session.queue.repeat_one_enabled);
}

#[test]
fn queue_boundary_validates_duplicates_selection_priorities_and_ids() {
    let mut queue = Queue::with_tracks(rows(&[1, 1]));
    assert!(queue.validate().is_ok());
    queue.displayed_tracks[1].row_key = "row:0".into();
    assert!(queue.validate().is_err());
    queue = Queue::with_tracks(rows(&[1]));
    queue.current_row_key = Some("missing".into());
    assert!(queue.validate().is_err());
    queue.current_row_key = None;
    queue.next_row_keys.insert("missing".into());
    assert!(queue.validate().is_err());
    queue.next_row_keys.clear();
    queue.displayed_tracks[0].track_id = Some(-1);
    assert!(queue.validate().is_err());
    queue.displayed_tracks[0].track_id = Some(MAX_SAFE_INTEGER + 1);
    assert!(queue.validate().is_err());
    queue.displayed_tracks[0].track_id = Some(1);
    queue.displayed_tracks[0].duration_ms = Some(MAX_SAFE_INTEGER as u64 + 1);
    assert!(queue.validate().is_err());
    let mut invalid = serde_json::to_value(Queue::with_tracks(rows(&[1]))).unwrap();
    invalid["nextRowKeys"] = serde_json::json!(["row:0", "row:0"]);
    assert!(serde_json::from_value::<Queue>(invalid).is_err());
}

#[test]
fn failed_explicit_row_or_replacement_preserves_the_previous_selection_and_suppresses_old_end() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    session.audio.failed.extend([2, 9]);
    assert!(
        !execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "row:1".into()
            }
        )
        .0
    );
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:0"));
    assert_eq!(current(&session), Some(1));
    assert!(!play(&mut session, &[9], 0));
    assert_eq!(ids(&session), [1, 2]);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("row:0"));
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2, 9]);
}

#[test]
fn removing_a_middle_current_row_never_rewinds_to_earlier_rows_after_stop_failure() {
    let mut session = fixture();
    play(&mut session, &[1, 2, 3], 1);
    session.audio.stop_result = Some(Err("busy".into()));
    execute(&mut session, SessionCommand::RemoveTrack { track_id: 2 });
    session.audio.stop_result = None;
    execute(&mut session, SessionCommand::Next);
    assert_eq!(session.audio.starts, [2, 3]);
    assert_eq!(current(&session), Some(3));
}
