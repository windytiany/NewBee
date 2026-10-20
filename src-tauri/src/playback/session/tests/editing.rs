use super::*;

#[test]
fn editing_releases_playing_or_paused_target_and_retains_selection_without_autoplay() {
    for paused in [false, true] {
        let mut session = fixture();
        play(&mut session, &[1, 2], 0);
        if paused {
            execute(&mut session, SessionCommand::Pause);
        }
        let token = execute(
            &mut session,
            SessionCommand::BeginEditing { track_ids: vec![1] },
        )
        .2
        .unwrap();
        assert!(session.playback_id.is_none());
        assert_eq!(current(&session), Some(1));
        assert!(session.snapshot().unwrap().is_editing);
        assert!(session
            .execute(
                SessionCommand::Next,
                session.generation.load(Ordering::SeqCst)
            )
            .is_err());
        session.update_metadata(vec![MetadataUpdate {
            id: 1,
            title: Some("Updated".into()),
            artist: Some("Artist 2".into()),
            album: Some("Album 2".into()),
            duration_ms: Some(200),
        }]);
        execute(&mut session, SessionCommand::EndEditing { token });
        session.tick().unwrap();
        assert_eq!(session.audio.starts, [1]);
        assert_eq!(session.audio.stops, [1]);
        assert_eq!(session.queue.current_row_key.as_deref(), Some("row:0"));
        assert_eq!(ids(&session), [1, 2]);
        assert_eq!(
            session.queue.current().unwrap().title.as_deref(),
            Some("Updated")
        );
        assert_eq!(
            session.current_track.as_ref().unwrap().title.as_deref(),
            Some("Updated")
        );
        execute(&mut session, SessionCommand::Toggle);
        assert_eq!(session.audio.starts, [1, 1]);
    }
}

#[test]
fn editing_other_file_cancels_prepared_decoder_without_stopping_current_audio() {
    let mut session = fixture();
    play(&mut session, &[1, 2], 0);
    let token = execute(
        &mut session,
        SessionCommand::BeginEditing { track_ids: vec![2] },
    )
    .2
    .unwrap();
    assert!(session.prepared.is_none());
    assert_eq!(session.audio.preparations.last().unwrap().1, None);
    assert!(session.audio.stops.is_empty());
    session.audio.ended = true;
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1]);
    execute(&mut session, SessionCommand::EndEditing { token });
    session.tick().unwrap();
    assert_eq!(session.audio.starts, [1, 2]);
}

#[test]
fn editing_requires_confirmed_release_and_rejects_stale_unlock_token() {
    let mut session = fixture();
    play(&mut session, &[1], 0);
    session.audio.stop_result = Some(Ok(false));
    let generation = session.generation.load(Ordering::SeqCst);
    assert!(session
        .execute(
            SessionCommand::BeginEditing { track_ids: vec![1] },
            generation
        )
        .is_err());
    assert!(session.editing.is_none());
    assert_eq!(session.playback_id, Some(1));
    session.audio.stop_result = None;
    let token = execute(
        &mut session,
        SessionCommand::BeginEditing { track_ids: vec![1] },
    )
    .2
    .unwrap();
    assert!(session
        .execute(SessionCommand::EndEditing { token: token + 1 }, generation)
        .is_err());
    assert!(session.editing.is_some());
    execute(&mut session, SessionCommand::EndEditing { token });
    assert!(session.editing.is_none());
}

#[test]
fn editing_protocol_rejects_paths_and_invalid_ids_without_releasing_audio() {
    assert!(serde_json::from_value::<SessionCommand>(serde_json::json!({
        "action": "beginEditing", "trackIds": [1], "paths": ["/track/1.wav"]
    }))
    .is_err());
    assert!(serde_json::from_value::<MetadataUpdate>(serde_json::json!({
        "id": 1, "path": "/track/1.wav", "title": null, "artist": null,
        "album": null, "durationMs": null
    }))
    .is_err());
    let mut session = fixture();
    play(&mut session, &[1], 0);
    let playback_id = session.playback_id;
    assert!(session
        .execute(
            SessionCommand::BeginEditing { track_ids: vec![0] },
            session.generation.load(Ordering::SeqCst)
        )
        .is_err());
    assert_eq!(session.playback_id, playback_id);
    assert!(session.audio.stops.is_empty());
    assert!(session.editing.is_none());
}

#[test]
fn file_targets_register_shared_identity_and_editing_protection() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory
        .path()
        .join("track.wav")
        .to_string_lossy()
        .into_owned();
    for file_source in [false, true] {
        let mut session = fixture();
        session.audio.library_paths.insert(1, path.clone());
        if file_source {
            let target = QueueTrack {
                track_id: None,
                path: Some(path.clone()),
                row_key: "file".into(),
                title: None,
                album: None,
                duration_ms: Some(100),
            };
            assert!(
                execute(
                    &mut session,
                    SessionCommand::PlayTracks {
                        tracks: vec![target],
                        start_row_key: Some("file".into()),
                        allow_skipped: true
                    }
                )
                .0
            );
            assert_eq!(session.current_track.as_ref().unwrap().track_id, Some(1));
            assert_eq!(session.queue.current().unwrap().track_id, Some(1));
            assert!(session.queue.current().unwrap().path.is_none());
        } else {
            play(&mut session, &[1], 0);
        }
        let before = session.playback_id;
        let token = execute(
            &mut session,
            SessionCommand::BeginEditing { track_ids: vec![2] },
        )
        .2
        .unwrap();
        assert_eq!(session.playback_id, before);
        execute(&mut session, SessionCommand::EndEditing { token });
        // A library edit must also release an Inbox audition of the same file.
        let token = execute(
            &mut session,
            SessionCommand::BeginEditing { track_ids: vec![1] },
        )
        .2
        .unwrap();
        assert!(session.playback_id.is_none());
        assert_eq!(session.audio.stops, [1]);
        execute(&mut session, SessionCommand::EndEditing { token });
        assert!(session.playback_id.is_none());
    }
    let mut session = fixture();
    session.audio.library_paths.insert(1, path.clone());
    play(&mut session, &[1], 0);
    let token = execute(
        &mut session,
        SessionCommand::BeginEditing { track_ids: vec![1] },
    )
    .2
    .unwrap();
    assert!(session.playback_id.is_none());
    assert_eq!(session.audio.stops, [1]);
    execute(&mut session, SessionCommand::EndEditing { token });
}
