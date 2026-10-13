use super::*;
use crate::lyrics::default_providers;
use crate::metadata::files::lyrics::embedded_lyrics_text;
use lofty::{
    config::WriteOptions,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::{cell::RefCell, fs, path::PathBuf, sync::mpsc, thread};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "newbee-lyrics-batch-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn library(&self) -> Database {
        let database = Database::open(self.0.join("library.sqlite3")).unwrap();
        let connection = rusqlite::Connection::open(self.0.join("library.sqlite3")).unwrap();
        for id in [1, 2] {
            let path = self.track(id);
            fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
            let mut tag = Tag::new(TagType::Id3v2);
            tag.insert_text(ItemKey::TrackTitle, format!("Song {id}"));
            tag.insert_text(ItemKey::UnsyncLyrics, "Old file lyrics".into());
            tag.save_to_path(&path, WriteOptions::default()).unwrap();
            connection
                .execute(
                    "INSERT INTO tracks (id, path, title) VALUES (?1, ?2, ?3)",
                    rusqlite::params![id, path.to_string_lossy(), format!("Song {id}")],
                )
                .unwrap();
        }
        database
    }
    fn track(&self, id: i64) -> PathBuf {
        self.0.join(format!("{id}.mp3"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn request(ids: &[i64]) -> BatchRequest {
    BatchRequest {
        track_ids: ids.to_vec(),
        operation_id: "lyrics-test:1".into(),
        providers: default_providers(),
    }
}
fn available(
    _: &TrackDetails,
    _: &[LyricsProvider],
    _: &AtomicBool,
) -> Result<LyricsContent, String> {
    Ok(LyricsContent::Available {
        text: "New lyrics".into(),
    })
}
fn assert_released(state: &LyricsBatchState, write: &WriteState, batch_id: u64) {
    assert!(state.task(batch_id).is_err());
    assert!(write.acquire().is_ok());
}

#[test]
fn runs_real_saves_marks_and_missing_results_and_releases_the_guard() {
    let fixture = Fixture::new();
    let sidecar = fixture.track(1).with_extension("lrc");
    fs::write(&sidecar, "[00:01.00]sidecar must remain untouched").unwrap();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let requested = RefCell::new(vec![]);
    let summary = thread::scope(|scope| {
        state
            .run(
                &database,
                &write,
                request(&[1, 2, 1, 99]),
                |event| {
                    assert!(write.acquire().is_err());
                    let payload = serde_json::to_value(&event).unwrap();
                    assert!(payload["batchId"].is_u64());
                    if let BatchEvent::SaveRequested {
                        batch_id,
                        step_id,
                        track_id,
                        ..
                    } = event
                    {
                        assert_eq!(payload["kind"], "saveRequested");
                        assert_eq!(payload["stepId"], step_id);
                        assert_eq!(payload["trackId"], track_id);
                        assert!(payload.get("text").is_none());
                        requested.borrow_mut().push(track_id);
                        let task = state.task(batch_id).unwrap();
                        assert_eq!(task.operation_id, "lyrics-test:1");
                        assert!(task.authorize(step_id + 100).is_err());
                        assert!(state.task(batch_id + 100).is_err());
                        scope.spawn(move || {
                            let saved = task.authorize(step_id).unwrap();
                            assert!(saved.file_written && saved.database_updated);
                            assert!(task.authorize(step_id).is_err());
                            task.complete(step_id, None).unwrap();
                            assert!(task.complete(step_id, None).is_err());
                        });
                    }
                    Ok(())
                },
                |track, _, _| {
                    if track.title() == Some("Song 2") {
                        Ok(LyricsContent::Instrumental)
                    } else {
                        available(track, &[], &AtomicBool::new(false))
                    }
                },
            )
            .unwrap()
    });
    assert_eq!(summary.status, BatchStatus::Completed);
    assert_eq!(*requested.borrow(), vec![1, 2]);
    assert_eq!(summary.results.len(), 3);
    assert_eq!(summary.results[2].kind, TrackKind::Failed);
    let payload = serde_json::to_value(&summary).unwrap();
    assert_eq!(payload["status"], "completed");
    assert_eq!(payload["results"][0]["result"]["databaseUpdated"], true);
    assert_eq!(payload["results"][1]["kind"], "instrumental");
    assert_eq!(
        database.get_lyrics(1).unwrap().text.as_deref(),
        Some("New lyrics")
    );
    assert_eq!(
        embedded_lyrics_text(&lofty::read_from_path(fixture.track(1)).unwrap()),
        Some("New lyrics")
    );
    assert_eq!(
        fs::read_to_string(&sidecar).unwrap(),
        "[00:01.00]sidecar must remain untouched"
    );
    assert!(database
        .get_editing_snapshot(1)
        .unwrap()
        .writable_fields
        .contains(&MetadataField::Lyrics));
    let marked = database.get_lyrics(2).unwrap();
    assert!(marked.text.is_none() && marked.no_lyrics);
    assert!(embedded_lyrics_text(&lofty::read_from_path(fixture.track(2)).unwrap()).is_none());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn missing_downloads_do_not_request_playback_or_save() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let summary = state
        .run(
            &database,
            &write,
            request(&[1]),
            |event| {
                assert!(!matches!(event, BatchEvent::SaveRequested { .. }));
                Ok(())
            },
            |_, _, _| Ok(LyricsContent::Missing),
        )
        .unwrap();
    assert_eq!(summary.results[0].kind, TrackKind::Missing);
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn rejects_busy_duplicate_and_invalid_starts_without_releasing_another_guard() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let guard = write.acquire().unwrap();
    assert!(state
        .run(&database, &write, request(&[1]), |_| Ok(()), available)
        .is_err());
    assert!(write.acquire().is_err());
    drop(guard);
    assert!(state
        .run(&database, &write, request(&[]), |_| Ok(()), available)
        .is_err());
    let summary = state
        .run(
            &database,
            &write,
            request(&[1]),
            |event| {
                if let BatchEvent::Started { batch_id, .. } = event {
                    assert!(state
                        .run(&database, &write, request(&[2]), |_| Ok(()), available)
                        .is_err());
                    state.cancel(batch_id).unwrap();
                }
                Ok(())
            },
            available,
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Cancelled);
    assert!(summary.results.is_empty());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn cancellation_during_lookup_discards_late_results_and_stops_the_next_track() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let id = RefCell::new(0);
    let summary = state
        .run(
            &database,
            &write,
            request(&[1, 2]),
            |event| {
                match event {
                    BatchEvent::Started { batch_id, .. } => *id.borrow_mut() = batch_id,
                    BatchEvent::SaveRequested { .. } => panic!("cancelled lookup cannot save"),
                    _ => {}
                }
                Ok(())
            },
            |_, _, cancelled| {
                state.cancel(*id.borrow()).unwrap();
                assert!(cancelled.load(Ordering::Acquire));
                available(&database.get_track(1).unwrap().unwrap(), &[], cancelled)
            },
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Cancelled);
    assert!(summary.results.is_empty());
    assert!(database.get_lyrics(1).unwrap().text.is_none());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn cancels_waiting_authorization_and_rejects_late_permissions() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let old_task = RefCell::new(None);
    let summary = state
        .run(
            &database,
            &write,
            request(&[1]),
            |event| {
                if let BatchEvent::SaveRequested {
                    batch_id, step_id, ..
                } = event
                {
                    let task = state.task(batch_id).unwrap();
                    state.cancel(batch_id).unwrap();
                    assert!(task.authorize(step_id).is_err());
                    *old_task.borrow_mut() = Some(task);
                }
                Ok(())
            },
            available,
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Cancelled);
    assert!(old_task.borrow().as_ref().unwrap().authorize(1).is_err());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn authorization_timeout_does_not_save_or_count_an_unstarted_track_as_failed() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState {
        timeout: Duration::ZERO,
        ..Default::default()
    };
    let write = WriteState::default();
    let task = RefCell::new(None);
    let summary = state
        .run(
            &database,
            &write,
            request(&[1, 2]),
            |event| {
                if let BatchEvent::SaveRequested { batch_id, .. } = event {
                    let expired = state.task(batch_id).unwrap();
                    assert!(expired.authorize(1).is_err());
                    assert!(expired.complete(1, Some("late rejection".into())).is_err());
                    *task.borrow_mut() = Some(expired);
                }
                Ok(())
            },
            available,
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Failed);
    assert!(summary.error.unwrap().contains("超时"));
    assert!(summary.results.is_empty());
    assert!(task.borrow().as_ref().unwrap().authorize(1).is_err());
    assert!(database.get_lyrics(1).unwrap().text.is_none());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn rejected_playback_preparation_counts_one_failure_and_continues() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let summary = state
        .run(
            &database,
            &write,
            request(&[1, 2]),
            |event| {
                if let BatchEvent::SaveRequested {
                    batch_id, step_id, ..
                } = event
                {
                    state
                        .task(batch_id)
                        .unwrap()
                        .complete(step_id, Some("playback unavailable".into()))
                        .unwrap();
                }
                Ok(())
            },
            available,
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Completed);
    assert_eq!(summary.results.len(), 2);
    assert!(summary
        .results
        .iter()
        .all(|outcome| outcome.result.is_none()
            && outcome.error.as_deref() == Some("playback unavailable")));
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn failed_progress_delivery_and_panics_both_release_the_running_lease() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let summary = state
        .run(
            &database,
            &write,
            request(&[1]),
            |_| Err("channel closed".into()),
            available,
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Failed);
    assert_released(&state, &write, summary.batch_id);
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        state.run(
            &database,
            &write,
            request(&[1]),
            |_| Ok(()),
            |_, _, _| panic!("lookup panic"),
        )
    }));
    assert!(panic.is_err());
    assert!(write.acquire().is_ok());
    assert!(state.task(summary.batch_id + 1).is_err());
}

#[test]
fn completion_timeout_keeps_the_confirmed_save_and_stops_the_batch() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState {
        timeout: Duration::from_millis(50),
        ..Default::default()
    };
    let write = WriteState::default();
    let summary = thread::scope(|scope| {
        state
            .run(
                &database,
                &write,
                request(&[1, 2]),
                |event| {
                    if let BatchEvent::SaveRequested {
                        batch_id, step_id, ..
                    } = event
                    {
                        let task = state.task(batch_id).unwrap();
                        scope.spawn(move || {
                            let _ = task.authorize(step_id);
                        });
                    }
                    Ok(())
                },
                available,
            )
            .unwrap()
    });
    assert_eq!(summary.status, BatchStatus::Failed);
    assert_eq!(summary.results.len(), 1);
    assert!(summary.results[0].result.as_ref().unwrap().database_updated);
    assert!(summary.error.unwrap().contains("超时"));
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn waits_for_frontend_cleanup_before_downloading_the_next_track() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let editing = Arc::new(AtomicBool::new(false));
    let summary = thread::scope(|scope| {
        state
            .run(
                &database,
                &write,
                request(&[1, 2]),
                |event| {
                    if let BatchEvent::SaveRequested {
                        batch_id, step_id, ..
                    } = event
                    {
                        let task = state.task(batch_id).unwrap();
                        let editing = Arc::clone(&editing);
                        let write = &write;
                        scope.spawn(move || {
                            editing.store(true, Ordering::Release);
                            task.authorize(step_id).unwrap();
                            assert!(write.acquire().is_err());
                            editing.store(false, Ordering::Release);
                            task.complete(step_id, None).unwrap();
                        });
                    }
                    Ok(())
                },
                |track, providers, cancelled| {
                    assert!(!editing.load(Ordering::Acquire));
                    available(track, providers, cancelled)
                },
            )
            .unwrap()
    });
    assert_eq!(summary.status, BatchStatus::Completed);
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn cancellation_during_a_real_commit_does_not_interrupt_it_or_start_the_next_track() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState {
        timeout: Duration::from_millis(100),
        ..Default::default()
    };
    let write = WriteState::default();
    let connection = rusqlite::Connection::open(fixture.0.join("library.sqlite3")).unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (written_tx, written_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let resume_rx = std::sync::Arc::new(std::sync::Mutex::new(resume_rx));
    let summary = thread::scope(|scope| {
        let running = scope.spawn(|| {
            let written_tx = written_tx.clone();
            let resume_rx = resume_rx.clone();
            *database.after_file_write.lock().unwrap() = Some(Box::new(move || {
                written_tx.send(()).unwrap();
                resume_rx.lock().unwrap().recv().unwrap();
            }));
            state
                .run(
                    &database,
                    &write,
                    request(&[1, 2]),
                    |event| {
                        if let BatchEvent::SaveRequested {
                            batch_id, step_id, ..
                        } = event
                        {
                            let task = state.task(batch_id).unwrap();
                            started_tx.send(batch_id).unwrap();
                            scope.spawn(move || {
                                let result = task.authorize(step_id).unwrap();
                                assert!(result.file_written && result.database_updated);
                                task.complete(step_id, None).unwrap();
                            });
                        }
                        Ok(())
                    },
                    available,
                )
                .unwrap()
        });
        let batch_id = started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        written_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            embedded_lyrics_text(&lofty::read_from_path(fixture.track(1)).unwrap()),
            Some("New lyrics")
        );
        connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        resume_tx.send(()).unwrap();
        state.cancel(batch_id).unwrap();
        // Hold the real database commit beyond the cooperation deadline: it must not time out.
        thread::sleep(Duration::from_millis(150));
        assert!(write.acquire().is_err());
        connection.execute_batch("COMMIT").unwrap();
        running.join().unwrap()
    });
    assert_eq!(summary.status, BatchStatus::Cancelled);
    assert_eq!(summary.results.len(), 1);
    assert!(summary.results[0].result.as_ref().unwrap().database_updated);
    assert!(database.get_lyrics(2).unwrap().text.is_none());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn database_failures_are_reported_per_track_without_stopping_the_batch() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let connection = rusqlite::Connection::open(fixture.0.join("library.sqlite3")).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_lyrics BEFORE INSERT ON track_lyrics BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;").unwrap();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let summary = thread::scope(|scope| {
        state
            .run(
                &database,
                &write,
                request(&[1, 2]),
                |event| {
                    if let BatchEvent::SaveRequested {
                        batch_id, step_id, ..
                    } = event
                    {
                        let task = state.task(batch_id).unwrap();
                        scope.spawn(move || {
                            let result = task.authorize(step_id).unwrap();
                            assert!(result.file_written && !result.database_updated);
                            assert!(result.error.unwrap().contains("database unavailable"));
                            task.complete(step_id, None).unwrap();
                        });
                    }
                    Ok(())
                },
                available,
            )
            .unwrap()
    });
    assert_eq!(summary.status, BatchStatus::Completed);
    assert_eq!(summary.results.len(), 2);
    assert!(summary.results.iter().all(|outcome| outcome
        .result
        .as_ref()
        .is_some_and(|result| result.file_written && !result.database_updated)));
    assert_eq!(
        embedded_lyrics_text(&lofty::read_from_path(fixture.track(1)).unwrap()),
        Some("New lyrics")
    );
    assert!(database.get_lyrics(1).unwrap().text.is_none());
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn malformed_content_is_a_track_failure_not_a_save_request() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let summary = state
        .run(
            &database,
            &write,
            request(&[1, 2]),
            |event| {
                assert!(!matches!(event, BatchEvent::SaveRequested { .. }));
                Ok(())
            },
            |track, _, _| {
                if track.title() == Some("Song 1") {
                    Ok(LyricsContent::Available {
                        text: " \n ".into(),
                    })
                } else {
                    Ok(LyricsContent::Missing)
                }
            },
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Completed);
    assert_eq!(summary.results[0].kind, TrackKind::Failed);
    assert_eq!(summary.results[1].kind, TrackKind::Missing);
    assert_released(&state, &write, summary.batch_id);
}

#[test]
fn a_failed_save_request_delivery_releases_the_guard_without_a_frontend_finish() {
    let fixture = Fixture::new();
    let database = fixture.library();
    let state = LyricsBatchState::default();
    let write = WriteState::default();
    let summary = state
        .run(
            &database,
            &write,
            request(&[1]),
            |event| {
                if matches!(event, BatchEvent::SaveRequested { .. }) {
                    Err("frontend unavailable".into())
                } else {
                    Ok(())
                }
            },
            available,
        )
        .unwrap();
    assert_eq!(summary.status, BatchStatus::Failed);
    assert!(summary.results.is_empty());
    assert_released(&state, &write, summary.batch_id);
}
