use super::super::Database;
use super::support::insert_track;

#[test]
fn skip_preferences_are_global_idempotent_and_atomic() {
    let database = Database::open(":memory:").unwrap();
    for id in [1, 2] {
        insert_track(&database, id, Some("Artist"), Some("Album"), id, None);
    }
    database.set_tracks_skipped(&[1, 1, 2], true).unwrap();
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![1, 2]);
    assert!(database.skipped_tracks().read().unwrap().contains(&1));
    assert!(database.set_tracks_skipped(&[1, 999], false).is_err());
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![1, 2]);
    assert!(database.skipped_tracks().read().unwrap().contains(&1));
    database.set_tracks_skipped(&[1], false).unwrap();
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![2]);
    assert!(!database.skipped_tracks().read().unwrap().contains(&1));
    database.remove_track_from_library(2).unwrap();
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![2]);
    assert!(database.skipped_tracks().read().unwrap().contains(&2));
}

#[test]
fn reopening_the_database_restores_skip_preferences_for_playback() {
    let directory = std::path::Path::new("/tmp");
    std::fs::create_dir_all(directory).unwrap();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = directory.join(format!(
        "newbee-track-skip-{}-{timestamp}.sqlite3",
        std::process::id()
    ));
    {
        let database = Database::open(&path).unwrap();
        insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
        database.set_tracks_skipped(&[1], true).unwrap();
    }
    {
        let database = Database::open(&path).unwrap();
        assert_eq!(database.list_skipped_track_ids().unwrap(), vec![1]);
        assert!(database.skipped_tracks().read().unwrap().contains(&1));
        database.set_tracks_skipped(&[1], false).unwrap();
    }
    {
        let database = Database::open(&path).unwrap();
        assert!(database.list_skipped_track_ids().unwrap().is_empty());
        assert!(database.skipped_tracks().read().unwrap().is_empty());
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn schema_adds_skip_preferences_to_existing_libraries_without_changing_tracks() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE tracks (id INTEGER PRIMARY KEY, album_artist TEXT, album TEXT); INSERT INTO tracks (id) VALUES (1);").unwrap();
    connection
        .execute_batch(super::super::schema::definition())
        .unwrap();
    connection
        .execute("INSERT INTO skipped_tracks (track_id) VALUES (1)", [])
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
