use super::*;
use crate::tracks::{discovery, model::TrackRegistrationResult};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Listener;

#[test]
fn measures_registration_decoder_and_bounded_confirmation_at_personal_library_scale() {
    for count in [1000_usize, 5000] {
        let directory = tempfile::tempdir().unwrap();
        let music = directory.path().join("music");
        std::fs::create_dir(&music).unwrap();
        for index in 0..count {
            std::fs::write(
                music.join(format!("{index:05}.flac")),
                include_bytes!("../../../fixtures/silence.flac"),
            )
            .unwrap();
        }
        let database = Database::open(directory.path().join("tracks.db")).unwrap();
        let paths = vec![music.to_string_lossy().into_owned()];
        let start = Instant::now();
        let discovered = discovery::discover(&paths);
        let discovery_elapsed = start.elapsed();
        assert_eq!(discovered.len(), count);
        let start = Instant::now();
        let registered = database.register_tracks(discovered).unwrap();
        let registration_elapsed = start.elapsed();
        let ids: Vec<_> = registered
            .iter()
            .map(|result| match result {
                TrackRegistrationResult::Registered {
                    track,
                    needs_metadata,
                } => {
                    assert!(*needs_metadata);
                    track.id
                }
                _ => panic!("registration failed"),
            })
            .collect();
        assert_eq!(ids.len(), count);
        assert_eq!(database.artwork_decode_count(), 0);
        let start = Instant::now();
        let first = database.get_track_for_playback(ids[0]).unwrap().unwrap();
        let decoder = rodio::Decoder::try_from(std::fs::File::open(first.path).unwrap()).unwrap();
        drop(decoder);
        let decoder_elapsed = start.elapsed();
        assert_eq!(database.pending_track_ids().unwrap().len(), count);
        let app = tauri::test::mock_builder()
            .manage(database)
            .manage(crate::locking::write::WriteState::default())
            .manage(SchedulingState::default())
            .build(tauri::generate_context!())
            .unwrap();
        let events = Arc::new(AtomicUsize::new(0));
        let completed = Arc::new(AtomicUsize::new(0));
        let observed_events = events.clone();
        let observed_completed = completed.clone();
        app.listen("tracks-confirmed", move |event| {
            let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            let results = payload.as_array().unwrap();
            assert!(results.len() <= BATCH_SIZE);
            assert!(results
                .iter()
                .all(|result| result["databaseUpdated"] == true && result["error"].is_null()));
            observed_events.fetch_add(1, Ordering::SeqCst);
            observed_completed.fetch_add(results.len(), Ordering::SeqCst);
        });
        let state = app.state::<SchedulingState>();
        assert!(state.enqueue(ids.clone()));
        assert!(!state.enqueue(ids.clone()));
        let start = Instant::now();
        drain(app.handle());
        let confirmation_elapsed = start.elapsed();
        assert!(!state.0.lock().unwrap().running);
        assert_eq!(completed.load(Ordering::SeqCst), count);
        assert_eq!(events.load(Ordering::SeqCst), count.div_ceil(BATCH_SIZE));
        let database = app.state::<Database>();
        assert!(database.pending_track_ids().unwrap().is_empty());
        assert_eq!(database.artwork_decode_count(), 0);
        let start = Instant::now();
        let repeated = super::super::registration::register(&database, &paths).unwrap();
        let hot_elapsed = start.elapsed();
        assert_eq!(repeated.len(), count);
        for (result, id) in repeated.iter().zip(&ids) {
            match result {
                TrackRegistrationResult::Registered {
                    track,
                    needs_metadata,
                } => {
                    assert_eq!(track.id, *id);
                    assert!(!needs_metadata);
                }
                _ => panic!("repeat registration failed"),
            }
        }
        crate::metadata::files::access::take(&music);
        let start = Instant::now();
        assert_eq!(database.get_tracks(&ids).unwrap().len(), count);
        let snapshots_elapsed = start.elapsed();
        let start = Instant::now();
        assert!(database.library_track_paths().unwrap().is_empty());
        let membership_elapsed = start.elapsed();
        assert!(crate::metadata::files::access::take(&music).is_empty());
        eprintln!(
            "B tracks={count} discovery_ms={:.2} new_db_registration_ms={:.2} first_id_to_decoder_ms={:.2} input_to_decoder_ms={:.2} metadata_ms={:.2} events={} workers=1 max_batch={BATCH_SIZE} hot_registration_ms={:.2} snapshots_ms={:.2} nonmember_library_query_ms={:.2} cover_decodes=0",
            discovery_elapsed.as_secs_f64() * 1000.0,
            registration_elapsed.as_secs_f64() * 1000.0,
            decoder_elapsed.as_secs_f64() * 1000.0,
            (discovery_elapsed + registration_elapsed + decoder_elapsed).as_secs_f64() * 1000.0,
            confirmation_elapsed.as_secs_f64() * 1000.0,
            events.load(Ordering::SeqCst),
            hot_elapsed.as_secs_f64() * 1000.0,
            snapshots_elapsed.as_secs_f64() * 1000.0,
            membership_elapsed.as_secs_f64() * 1000.0,
        );
    }
}
