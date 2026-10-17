use super::*;

#[test]
fn initializes_new_databases_and_can_reopen_them() {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_schema(&mut connection).unwrap();
    initialize_schema(&mut connection).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
    connection.execute("INSERT INTO tracks (path, track_number, track_total, disc_number, disc_total) VALUES ('song.mp3', 1, 7, 1, 2)", []).unwrap();
    let thumbnails: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'artwork_thumbnails')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!thumbnails);
}

#[test]
fn upgrade_clears_legacy_counts_once_and_preserves_library_data() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(definition()).unwrap();
    connection
        .execute_batch(
            "DROP TRIGGER clear_statistics_after_library_removal;
        INSERT INTO tracks (path, in_library) VALUES ('song.mp3', 1);
        INSERT INTO track_play_statistics VALUES (1, 8);
        PRAGMA user_version = 1;",
        )
        .unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM track_play_statistics", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row("SELECT path FROM tracks", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "song.mp3"
    );
    connection
        .execute("INSERT INTO track_play_statistics VALUES (1, 1)", [])
        .unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT play_count FROM track_play_statistics", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        1
    );
    connection
        .execute("UPDATE tracks SET in_library = 0", [])
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM track_play_statistics", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        0
    );
}

#[test]
fn upgrade_from_version_two_adds_scan_cache_without_clearing_counts() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(definition()).unwrap();
    connection
        .execute_batch(
            "DROP TABLE track_scan;
        INSERT INTO tracks (path, in_library) VALUES ('song.mp3', 1);
        INSERT INTO track_play_statistics VALUES (1, 8);
        PRAGMA user_version = 2;",
        )
        .unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT play_count FROM track_play_statistics", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        8
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM track_scan", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        SCHEMA_VERSION
    );
}

#[test]
fn rejects_old_schema_without_modifying_it() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT); INSERT INTO tracks VALUES (42, 'song.mp3');").unwrap();
    assert!(initialize_schema(&mut connection).is_err());
    assert_eq!(
        connection
            .query_row("SELECT path FROM tracks WHERE id = 42", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "song.mp3"
    );
}

#[test]
fn rejects_other_versions_without_changing_snapshots_or_schema() {
    for version in [0, SCHEMA_VERSION + 1, SCHEMA_VERSION + 2] {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT, title TEXT); INSERT INTO tracks VALUES (42, 'song.mp3', 'Stored'); PRAGMA foreign_keys = ON;").unwrap();
        connection
            .pragma_update(None, "user_version", version)
            .unwrap();
        let schema: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name = 'tracks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(initialize_schema(&mut connection).is_err());
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            version
        );
        assert_eq!(
            connection
                .pragma_query_value::<i64, _>(None, "foreign_keys", |row| row.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT path, title FROM tracks WHERE id = 42",
                    [],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                )
                .unwrap(),
            ("song.mp3".into(), "Stored".into())
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE name = 'tracks'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            schema
        );
    }
}

#[test]
fn library_membership_defaults_to_false_and_rejects_invalid_values() {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_schema(&mut connection).unwrap();
    connection
        .execute("INSERT INTO tracks (path) VALUES ('song.mp3')", [])
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT in_library FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    for invalid in ["NULL", "-1", "2"] {
        assert!(connection
            .execute(&format!("UPDATE tracks SET in_library = {invalid}"), [])
            .is_err());
    }
}

#[test]
fn inbox_schema_uses_track_identity_and_cascades_deleted_tracks() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    initialize_schema(&mut connection).unwrap();
    let columns: Vec<String> = connection
        .prepare("PRAGMA table_info(inbox)")
        .unwrap()
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(columns, ["track_id", "added_at"]);
    assert!(connection
        .execute("INSERT INTO inbox(track_id,added_at) VALUES (42,123)", [])
        .is_err());
    connection
        .execute("INSERT INTO tracks(id,path) VALUES (42,'song.flac')", [])
        .unwrap();
    connection
        .execute("INSERT INTO inbox(track_id,added_at) VALUES (42,123)", [])
        .unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT track_id,added_at FROM inbox", [], |row| Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?
            )))
            .unwrap(),
        (42, 123)
    );
    connection
        .execute("DELETE FROM tracks WHERE id=42", [])
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM inbox", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
