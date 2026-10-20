use super::*;

#[test]
fn registration_and_ingest_rescan_once_preserving_identity_and_added_at() {
    let fixture = TestFiles::new();
    let path = canonical(fixture.wav("track.wav"));
    let database = Database::open(":memory:").unwrap();
    files::write_file(Path::new(&path), &[title("First")]).unwrap();
    let registration = crate::tracks::register(&database, std::slice::from_ref(&path)).unwrap();
    let crate::tracks::model::TrackRegistrationResult::Registered {
        track,
        needs_metadata,
    } = &registration[0]
    else {
        panic!("Expected registered track");
    };
    let track_id = track.id;
    assert!(needs_metadata);
    assert!(database.library_track_paths().unwrap().is_empty());
    assert!(database.inbox_paths().unwrap().is_empty());
    assert!(register(&database, vec![path.clone()])[0].success);
    assert_eq!(id(&database, &path), track_id);
    let playlist = database.create_playlist("Saved").unwrap();
    database
        .append_playlist_tracks(playlist, vec![track_id])
        .unwrap();
    database.record_track_play(track_id).unwrap();
    database.set_tracks_skipped(&[track_id], true).unwrap();
    database
        .connection()
        .unwrap()
        .execute("UPDATE inbox SET added_at = 123", [])
        .unwrap();
    files::write_file(Path::new(&path), &[title("External")]).unwrap();
    files::access::take(&fixture.0);
    let before = refresh(&database).unwrap();
    assert_eq!(before.tracks[0].track.title.as_deref(), Some("First"));
    assert_eq!(before.tracks[0].track.id, track_id);
    assert!(files::access::take(&fixture.0).is_empty());
    let result = register(&database, vec![path.clone()]);
    assert!(result[0].success && !result[0].skipped);
    assert_eq!(result[0].track_id, Some(track_id));
    assert_eq!(refresh(&database).unwrap().tracks[0].added_at, 123);
    assert_eq!(
        database
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("External")
    );
    files::write_file(Path::new(&path), &[title("Ingested")]).unwrap();
    files::access::take(&fixture.0);
    assert!(ingest(&database, vec![track_id])[0].success);
    assert_eq!(
        files::access::take(&fixture.0)
            .iter()
            .filter(|(_, kind)| *kind == "parse")
            .count(),
        1
    );
    assert_eq!(
        database.library_track_paths().unwrap(),
        std::slice::from_ref(&path)
    );
    assert!(database.inbox_paths().unwrap().is_empty());
    assert_eq!(
        database
            .get_track(track_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("Ingested")
    );
    assert!(database.record_track_play(track_id).unwrap());
    files::write_file(Path::new(&path), &[title("Inbox again")]).unwrap();
    assert!(register(&database, vec![path.clone()])[0].success);
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(id(&database, &path), track_id);
    assert!(database.list_playback_statistics().unwrap().is_empty());
    assert_eq!(database.list_skipped_track_ids().unwrap(), [track_id]);
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap()[0]["title"],
        "Inbox again"
    );
}

#[test]
fn batch_failure_preserves_membership_and_last_successful_snapshot() {
    let fixture = TestFiles::new();
    let good = canonical(fixture.wav("good.wav"));
    let blocked = canonical(fixture.wav("blocked.wav"));
    let database = Database::open(":memory:").unwrap();
    for path in [&good, &blocked] {
        crate::library::import::import_track(&database, Path::new(path), &mut Default::default());
        files::write_file(Path::new(path), &[title("Changed")]).unwrap();
    }
    let blocked_id = id(&database, &blocked);
    database.connection().unwrap().execute_batch("CREATE TRIGGER reject_membership BEFORE UPDATE OF in_library ON tracks WHEN NEW.in_library = 0 AND OLD.path LIKE '%blocked.wav' BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
    let results = register(
        &database,
        vec![
            good.clone(),
            blocked.clone(),
            fixture.0.join("missing.wav").to_string_lossy().into_owned(),
        ],
    );
    assert!(results[0].success);
    assert!(!results[1].success && !results[2].success);
    assert!(results[1].error.as_deref().unwrap().contains("blocked"));
    assert_eq!(database.inbox_paths().unwrap(), std::slice::from_ref(&good));
    assert_eq!(
        database.library_track_paths().unwrap(),
        std::slice::from_ref(&blocked)
    );
    assert_eq!(database.get_track(blocked_id).unwrap().unwrap().title, None);
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_membership")
        .unwrap();
    assert!(register(&database, vec![blocked.clone()])[0].success);
    let good_id = id(&database, &good);
    std::fs::remove_file(&blocked).unwrap();
    let results = ingest(&database, vec![good_id, blocked_id]);
    assert!(results[0].success && !results[1].success);
    assert_eq!(
        database.inbox_paths().unwrap(),
        std::slice::from_ref(&blocked)
    );
    assert_eq!(
        refresh(&database).unwrap().tracks[0].track.title.as_deref(),
        Some("Changed")
    );
    assert!(refresh(&database).unwrap().failures.is_empty());
    assert!(!register(&database, vec![blocked.clone()])[0].success);
    assert_eq!(database.inbox_paths().unwrap(), [blocked]);
}
