use super::*;

#[test]
fn volume_defaults_to_fifty_and_mute_restores_last_nonzero_level() {
    let mut session = fixture();
    assert_eq!(session.snapshot().unwrap().volume, 50);
    assert_eq!(session.audio.volume, 50);
    execute(&mut session, SessionCommand::Volume { volume: 23 });
    assert_eq!(session.volume.last_non_muted_volume, 23);
    execute(&mut session, SessionCommand::Mute);
    assert_eq!(session.audio.volume, 0);
    assert_eq!(session.volume.volume, 0);
    execute(&mut session, SessionCommand::Mute);
    assert_eq!(session.audio.volume, 23);
    execute(&mut session, SessionCommand::Volume { volume: 0 });
    execute(&mut session, SessionCommand::Mute);
    assert_eq!(session.volume.volume, 23);
}

#[test]
fn restored_volume_applies_before_system_play_even_without_frontend_initialization() {
    let saved = SavedSession {
        queue: Queue::with_tracks(rows(&[1])),
        current_track: None,
        volume: VolumePreferences {
            volume: 0,
            last_non_muted_volume: 19,
        },
    };
    let mut saved = saved;
    saved.queue.current_row_key = Some("row:0".into());
    let mut session = Session::new(FakeAudio::default(), saved, Arc::new(AtomicU64::new(0)));
    assert_eq!(session.audio.volume, 0);
    execute(
        &mut session,
        SessionCommand::System {
            operation: SystemOperation::Play,
        },
    );
    assert_eq!(session.audio.starts, [1]);
    assert_eq!(session.audio.volume, 0);
    execute(&mut session, SessionCommand::Mute);
    assert_eq!(session.audio.volume, 19);
}

#[test]
fn volume_failure_or_invalid_level_never_commits_unapplied_preference() {
    let mut session = fixture();
    session.audio.volume_failure = true;
    assert!(session
        .execute(SessionCommand::Volume { volume: 25 }, 0)
        .is_err());
    assert_eq!(session.volume.volume, 50);
    assert_eq!(session.volume.last_non_muted_volume, 50);
    session.audio.volume_failure = false;
    assert!(session
        .execute(SessionCommand::Volume { volume: 101 }, 0)
        .is_err());
    assert_eq!(session.volume.volume, 50);
    execute(&mut session, SessionCommand::Volume { volume: 25 });
    assert_eq!(session.volume.volume, 25);
}

#[test]
fn persisted_mute_and_memory_survive_session_restart() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("newbee-volume-{unique}.json"));
    let mut session = fixture();
    execute(&mut session, SessionCommand::Volume { volume: 42 });
    execute(&mut session, SessionCommand::Mute);
    let (mut persistence, _) = SessionPersistence::load(path.clone());
    persistence.save(&session.saved()).unwrap();
    let (_, saved) = SessionPersistence::load(path.clone());
    let mut restored = Session::new(FakeAudio::default(), saved, Arc::new(AtomicU64::new(0)));
    assert_eq!(restored.audio.volume, 0);
    execute(&mut restored, SessionCommand::Mute);
    assert_eq!(restored.audio.volume, 42);
    std::fs::remove_file(path).unwrap();
}
