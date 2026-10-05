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
fn adds_totals_without_losing_existing_tracks_or_playlist_references() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(
        "CREATE TABLE tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE,
            title TEXT, artist TEXT, album TEXT, album_artist TEXT, release_date TEXT,
            disc_number INTEGER, track_number INTEGER, duration_ms INTEGER,
            codec TEXT, sample_rate_hz INTEGER, bitrate_kbps INTEGER, channels INTEGER
         );
         INSERT INTO tracks (id, path, title, track_number) VALUES (42, 'song.mp3', 'Original', 1);
         CREATE TABLE playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
         INSERT INTO playlists (id, name) VALUES (1, 'Favorites');
         CREATE TABLE playlist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id INTEGER NOT NULL REFERENCES playlists(id), track_id INTEGER NOT NULL REFERENCES tracks(id), position INTEGER NOT NULL);
         INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 42, 0);"
    ).unwrap();
    initialize_schema(&mut connection).unwrap();
    initialize_schema(&mut connection).unwrap();
    let (title, total): (String, Option<i64>) = connection
        .query_row(
            "SELECT title, track_total FROM tracks WHERE id = 42",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(title, "Original");
    assert!(total.is_none());
    let track_id: i64 = connection
        .query_row("SELECT track_id FROM playlist_items", [], |row| row.get(0))
        .unwrap();
    assert_eq!(track_id, 42);
}
