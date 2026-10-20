use super::*;

#[test]
fn recursive_registration_scans_duplicates_and_rejects_broken_new_files() {
    let fixture = TestFiles::new();
    std::fs::create_dir(fixture.0.join("nested")).unwrap();
    fixture.wav("one.wav");
    fixture.wav("nested/two.wav");
    fixture.write("broken.flac", b"not audio");
    fixture.write("ignored.txt", b"not audio");
    let database = Database::open(":memory:").unwrap();
    let results = register_directories(&database, vec![fixture.0.to_string_lossy().into_owned()]);
    assert_eq!(results.iter().filter(|result| result.success).count(), 2);
    assert_eq!(results.iter().filter(|result| !result.success).count(), 1);
    let again = register_directories(&database, vec![fixture.0.to_string_lossy().into_owned()]);
    assert_eq!(
        again
            .iter()
            .filter(|result| result.success && !result.skipped)
            .count(),
        2
    );
    assert_eq!(database.inbox_paths().unwrap().len(), 2);
}

#[test]
fn initial_artwork_failure_registers_nothing_and_ingest_database_failure_is_atomic() {
    let fixture = TestFiles::new();
    let first = canonical(fixture.wav("first.wav"));
    let second = canonical(fixture.wav("second.wav"));
    let cover = fixture.write("cover.png", b"broken picture");
    let database = Database::open(":memory:").unwrap();
    assert!(!register(&database, vec![first.clone()])[0].success);
    assert!(database.inbox_entries().unwrap().is_empty());
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    std::fs::write(&cover, include_bytes!("../../../fixtures/cover.png")).unwrap();
    for path in [&first, &second] {
        files::write_file(Path::new(path), &[title("Before")]).unwrap();
        assert!(register(&database, vec![path.clone()])[0].success);
    }
    let first_id = id(&database, &first);
    let second_id = id(&database, &second);
    let before = serde_json::to_value(database.get_track(first_id).unwrap()).unwrap();
    let editing = serde_json::to_value(database.get_editing_snapshot(first_id).unwrap()).unwrap();
    let original = database.get_artwork_collection(first_id).unwrap();
    let added_at = database.inbox_entries().unwrap()[0].1;
    for path in [&first, &second] {
        files::write_file(Path::new(path), &[title("After")]).unwrap();
    }
    std::fs::remove_file(&cover).unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(&format!(
            "CREATE TRIGGER reject_ingest BEFORE DELETE ON inbox WHEN OLD.track_id={} BEGIN
         UPDATE tracks SET title='side effect' WHERE id={};
         SELECT RAISE(FAIL, 'ingest failure'); END;",
            first_id, second_id
        ))
        .unwrap();
    let results = ingest(&database, vec![first_id, second_id]);
    assert!(!results[0].success && results[1].success);
    assert!(results[0]
        .error
        .as_deref()
        .unwrap()
        .contains("ingest failure"));
    assert_eq!(
        serde_json::to_value(database.get_track(first_id).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        serde_json::to_value(database.get_editing_snapshot(first_id).unwrap()).unwrap(),
        editing
    );
    assert_eq!(
        database.get_artwork_collection(first_id).unwrap().images[0].content_id,
        original.images[0].content_id
    );
    assert_eq!(database.inbox_entries().unwrap(), [(first_id, added_at)]);
    assert_eq!(database.library_track_paths().unwrap(), [second]);
    assert_eq!(
        database
            .get_track(second_id)
            .unwrap()
            .unwrap()
            .title
            .as_deref(),
        Some("After")
    );
    assert!(database
        .get_artwork_collection(second_id)
        .unwrap()
        .images
        .is_empty());
}
