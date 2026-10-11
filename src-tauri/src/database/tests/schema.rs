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
}

#[test]
fn upgrades_version_four_without_changing_library_data() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(&crate::database::schema_sql())
        .unwrap();
    connection.execute_batch("DROP TABLE track_play_statistics; PRAGMA user_version = 4; INSERT INTO tracks (path, title) VALUES ('song.mp3', 'Song'); INSERT INTO skipped_tracks VALUES (1);").unwrap();
    initialize_schema(&mut connection).unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT title FROM tracks WHERE id = 1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "Song"
    );
    assert_eq!(
        connection
            .query_row("SELECT track_id FROM skipped_tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    connection
        .execute("INSERT INTO track_play_statistics VALUES (1, 1)", [])
        .unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
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
fn thumbnail_schema_enforces_the_artwork_request_size_range() {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_schema(&mut connection).unwrap();
    connection
        .execute(
            "INSERT INTO artwork_images (id, mime_type, image) VALUES (1, 'image/png', X'00')",
            [],
        )
        .unwrap();
    for size in [1, crate::artwork::MAX_ARTWORK_SIZE] {
        connection
            .execute(
                "INSERT INTO artwork_thumbnails (image_id, size, image) VALUES (1, ?1, X'00')",
                [size],
            )
            .unwrap();
    }
    for size in [0, crate::artwork::MAX_ARTWORK_SIZE + 1] {
        assert!(connection
            .execute(
                "INSERT INTO artwork_thumbnails (image_id, size, image) VALUES (1, ?1, X'00')",
                [size]
            )
            .is_err());
    }
}
