use super::*;
use crate::{database::Database, metadata::files};
use std::path::Path;

fn target(path: &str, key: &str) -> QueueTrack {
    QueueTrack {
        track_id: None,
        path: Some(path.into()),
        row_key: key.into(),
        title: None,
        album: None,
        duration_ms: None,
    }
}

#[test]
fn registered_queue_targets_do_not_require_the_metadata_writer_lock() {
    let database = Database::open(":memory:").unwrap();
    let write = crate::locking::write::WriteState::default();
    let _metadata_write = write.acquire().unwrap();
    let mut tracks = rows(&[1, 2]);
    let original = tracks.clone();
    for _ in 0..2 {
        let registration = super::super::audio::register(&database, &write, &mut tracks).unwrap();
        assert!(registration.pending.is_empty());
        assert!(registration.failures.is_empty());
        assert_eq!(tracks, original);
    }
    assert!(write.acquire().is_err());
}

#[test]
fn path_registration_still_requires_the_writer_lock() {
    let database = Database::open(":memory:").unwrap();
    let write = crate::locking::write::WriteState::default();
    let _metadata_write = write.acquire().unwrap();
    let mut tracks = vec![target("/song.wav", "path")];
    let original = tracks.clone();
    assert!(super::super::audio::register(&database, &write, &mut tracks).is_err());
    assert_eq!(tracks, original);
}

#[test]
fn path_batch_reuses_ids_without_clearing_inbox_membership_statistics_or_skip() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let path = path.canonicalize().unwrap().to_string_lossy().into_owned();
    let database = Database::open(":memory:").unwrap();
    database.register_inbox_path(&path).unwrap();
    let mut registered = vec![target(&path, "existing")];
    super::super::identity::register(&database, &mut registered).unwrap();
    let id = registered[0].track_id.unwrap();
    database.record_track_play(id).unwrap();
    database.set_tracks_skipped(&[id], true).unwrap();
    let audio = FakeAudio {
        database: Some(database),
        ..FakeAudio::default()
    };
    let mut session = Session::new(audio, SavedSession::default(), Arc::new(AtomicU64::new(0)));
    execute(
        &mut session,
        SessionCommand::Add {
            tracks: vec![target(&path, "a"), target(&path, "b")],
            next: false,
        },
    );
    assert_eq!(session.audio.registrations, 1);
    assert_eq!(ids(&session), [id, id]);
    assert!(session
        .queue
        .displayed_tracks
        .iter()
        .all(|track| track.path.is_none()));
    let key = session.queue.displayed_tracks[1].row_key.clone();
    assert!(
        execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: key.clone()
            }
        )
        .0
    );
    assert_eq!(session.queue.current_row_key.as_deref(), Some(key.as_str()));
    assert_eq!(current(&session), Some(id));
    assert_eq!(
        session.current_track.as_ref().unwrap().path.as_deref(),
        Some(path.as_str())
    );
    assert_eq!(session.audio.decoder_attempts, [id]);
    let database = session.audio.database.as_ref().unwrap();
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&path));
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(database.list_skipped_track_ids().unwrap(), [id]);
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row(
                "SELECT play_count FROM track_play_statistics WHERE track_id = ?1",
                [id],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert!(files::access::take(directory.path()).is_empty());
    let snapshot = database.get_track(id).unwrap().unwrap();
    assert_eq!(snapshot.path, path);
    assert_eq!(
        crate::playback::target_info(session.queue.current().unwrap(), database)
            .unwrap()
            .path,
        snapshot.path
    );
    let token = execute(
        &mut session,
        SessionCommand::BeginEditing {
            track_ids: vec![id],
            paths: vec![],
        },
    )
    .2
    .unwrap();
    assert!(session.playback_id.is_none());
    execute(&mut session, SessionCommand::EndEditing { token });
}

#[test]
fn broken_tags_are_not_a_decoder_prerequisite_and_decode_failure_retains_queue() {
    use lofty::{
        config::WriteOptions,
        picture::{Picture, PictureType},
        prelude::TagExt,
        tag::{Tag, TagType},
    };
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    std::fs::write(&path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let mut tag = Tag::new(TagType::VorbisComments);
    tag.push_picture(
        Picture::unchecked(b"broken picture".to_vec())
            .pic_type(PictureType::CoverFront)
            .build(),
    );
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert!(files::read_track(&path).is_err());
    files::access::take(directory.path());
    let audio = FakeAudio {
        database: Some(Database::open(":memory:").unwrap()),
        ..FakeAudio::default()
    };
    let mut session = Session::new(audio, SavedSession::default(), Arc::new(AtomicU64::new(0)));
    assert!(
        execute(
            &mut session,
            SessionCommand::PlayTracks {
                tracks: vec![target(&path.to_string_lossy(), "aac")],
                start_row_key: "aac".into(),
                allow_skipped: true
            }
        )
        .0
    );
    let id = current(&session).unwrap();
    assert_eq!(session.audio.decoder_attempts, [id]);
    assert!(files::access::take(directory.path()).is_empty());
    // A file becoming invalid after registration reaches the decoder, not the tag reader.
    std::fs::write(&path, b"invalid audio").unwrap();
    assert!(
        !execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "aac".into()
            }
        )
        .0
    );
    assert_eq!(session.audio.decoder_attempts, [id, id]);
    assert_eq!(ids(&session), [id]);
    assert!(session
        .snapshot()
        .unwrap()
        .queue_playback_error
        .contains("decode"));
    assert!(files::access::take(directory.path()).is_empty());
    std::fs::remove_file(&path).unwrap();
    assert!(
        !execute(
            &mut session,
            SessionCommand::PlayItem {
                row_key: "aac".into()
            }
        )
        .0
    );
    assert_eq!(ids(&session), [id]);
    assert!(session
        .snapshot()
        .unwrap()
        .queue_playback_error
        .contains("AUDIO_FILE_NOT_FOUND:"));
    assert!(!Path::new(
        &session
            .current_track
            .as_ref()
            .unwrap()
            .path
            .clone()
            .unwrap()
    )
    .exists());
}

#[test]
fn partial_path_add_keeps_successes_duplicates_and_reports_each_failure() {
    let directory = tempfile::tempdir().unwrap();
    let good = directory.path().join("good.flac");
    let rejected = directory.path().join("rejected.flac");
    for path in [&good, &rejected] {
        std::fs::write(path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    }
    let missing = directory.path().join("missing.flac");
    let database = Database::open(":memory:").unwrap();
    database.connection().unwrap().execute_batch("CREATE TRIGGER reject_registration BEFORE INSERT ON tracks WHEN NEW.title = 'rejected' BEGIN SELECT RAISE(FAIL, 'registration fixture failure'); END;").unwrap();
    let audio = FakeAudio {
        database: Some(database),
        ..FakeAudio::default()
    };
    let mut session = Session::new(audio, SavedSession::default(), Arc::new(AtomicU64::new(0)));
    assert!(
        session
            .execute(
                SessionCommand::Add {
                    tracks: vec![
                        target(&good.to_string_lossy(), "good"),
                        target(&rejected.to_string_lossy(), "rejected"),
                        target(&missing.to_string_lossy(), "missing"),
                        target(&good.to_string_lossy(), "duplicate")
                    ],
                    next: false
                },
                0
            )
            .unwrap()
            .0
    );
    assert_eq!(session.queue.displayed_tracks.len(), 2);
    let id = session.queue.displayed_tracks[0].track_id.unwrap();
    assert_eq!(ids(&session), [id, id]);
    assert_eq!(session.audio.registrations, 1);
    assert_eq!(session.audio.scheduled, [id]);
    assert!(session.audio.starts.is_empty());
    let errors = session.snapshot().unwrap().queue_playback_error;
    assert!(errors.contains("registration fixture failure"));
    assert!(errors.contains("missing.flac"));
    assert_eq!(
        session
            .audio
            .database
            .as_ref()
            .unwrap()
            .get_tracks(&[id])
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn partial_path_replacement_keeps_successful_rows_when_requested_start_registration_fails() {
    let directory = tempfile::tempdir().unwrap();
    let good = directory.path().join("good.flac");
    std::fs::write(&good, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let missing = directory.path().join("missing.flac");
    let audio = FakeAudio {
        database: Some(Database::open(":memory:").unwrap()),
        ..FakeAudio::default()
    };
    let mut session = Session::new(audio, SavedSession::default(), Arc::new(AtomicU64::new(0)));
    assert!(
        session
            .execute(
                SessionCommand::PlayTracks {
                    tracks: vec![
                        target(&missing.to_string_lossy(), "missing"),
                        target(&good.to_string_lossy(), "good"),
                        target(&good.to_string_lossy(), "duplicate")
                    ],
                    start_row_key: "missing".into(),
                    allow_skipped: true
                },
                0
            )
            .unwrap()
            .0
    );
    assert_eq!(session.queue.displayed_tracks.len(), 2);
    assert_eq!(session.queue.current_row_key.as_deref(), Some("good"));
    assert_eq!(session.audio.starts.len(), 1);
    assert_eq!(
        current(&session),
        session.queue.displayed_tracks[0].track_id
    );
    assert!(session
        .snapshot()
        .unwrap()
        .queue_playback_error
        .contains("missing.flac"));
}

#[test]
fn entirely_failed_path_add_replacement_and_single_target_preserve_existing_audio_and_queue() {
    let directory = tempfile::tempdir().unwrap();
    let good = directory.path().join("good.flac");
    std::fs::write(&good, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let missing = directory.path().join("missing.flac");
    let audio = FakeAudio {
        database: Some(Database::open(":memory:").unwrap()),
        ..FakeAudio::default()
    };
    let mut session = Session::new(audio, SavedSession::default(), Arc::new(AtomicU64::new(0)));
    execute(
        &mut session,
        SessionCommand::PlayTracks {
            tracks: vec![
                target(&good.to_string_lossy(), "good"),
                target(&good.to_string_lossy(), "duplicate"),
            ],
            start_row_key: "good".into(),
            allow_skipped: true,
        },
    );
    let before = session.queue.displayed_tracks.clone();
    let starts = session.audio.starts.clone();
    let preparations = session.audio.preparations.clone();
    for command in [
        SessionCommand::Add {
            tracks: vec![target(&missing.to_string_lossy(), "missing")],
            next: true,
        },
        SessionCommand::PlayTracks {
            tracks: vec![target(&missing.to_string_lossy(), "missing")],
            start_row_key: "missing".into(),
            allow_skipped: true,
        },
    ] {
        assert!(!session.execute(command, 0).unwrap().0);
        assert_eq!(session.queue.displayed_tracks, before);
        assert_eq!(session.queue.current_row_key.as_deref(), Some("good"));
        assert_eq!(session.audio.starts, starts);
        assert!(session.audio.stops.is_empty());
        assert_eq!(session.audio.preparations, preparations);
        assert!(session
            .snapshot()
            .unwrap()
            .queue_playback_error
            .contains("missing.flac"));
    }
}

#[test]
fn partial_path_batches_preserve_prior_successes_for_next_end_and_replace() {
    for next in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let initial = directory.path().join("initial.flac");
        let good = directory.path().join("good.flac");
        for path in [&initial, &good] {
            std::fs::write(path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
        }
        let missing = directory.path().join("missing.flac");
        let audio = FakeAudio {
            database: Some(Database::open(":memory:").unwrap()),
            ..FakeAudio::default()
        };
        let mut session = Session::new(audio, SavedSession::default(), Arc::new(AtomicU64::new(0)));
        execute(
            &mut session,
            SessionCommand::PlayTracks {
                tracks: vec![target(&initial.to_string_lossy(), "initial")],
                start_row_key: "initial".into(),
                allow_skipped: true,
            },
        );
        let original_id = current(&session).unwrap();
        let batch = vec![
            target(&good.to_string_lossy(), "good"),
            target(&missing.to_string_lossy(), "missing"),
        ];
        assert!(
            execute(
                &mut session,
                SessionCommand::Add {
                    tracks: batch.clone(),
                    next
                }
            )
            .0
        );
        let good_id = session.queue.displayed_tracks[1].track_id.unwrap();
        assert_eq!(ids(&session), [original_id, good_id]);
        assert_eq!(session.audio.starts, [original_id]);
        assert_eq!(current(&session), Some(original_id));
        assert!(session
            .snapshot()
            .unwrap()
            .queue_playback_error
            .contains("missing.flac"));
        assert!(
            execute(
                &mut session,
                SessionCommand::PlayTracks {
                    tracks: batch,
                    start_row_key: "good".into(),
                    allow_skipped: true
                }
            )
            .0
        );
        assert_eq!(ids(&session), [good_id]);
        assert_eq!(session.audio.starts, [original_id, good_id]);
        assert_eq!(current(&session), Some(good_id));
        assert!(session
            .snapshot()
            .unwrap()
            .queue_playback_error
            .contains("missing.flac"));
        assert_eq!(
            session
                .audio
                .database
                .as_ref()
                .unwrap()
                .get_tracks(&[original_id, good_id])
                .unwrap()
                .len(),
            2
        );
    }
}
