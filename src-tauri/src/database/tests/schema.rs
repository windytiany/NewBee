use super::*;
use sha2::{Digest, Sha256};

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

fn old_schema(connection: &Connection, version: i64) {
    connection.execute_batch(
        "CREATE TABLE artwork_images (id INTEGER PRIMARY KEY AUTOINCREMENT, mime_type TEXT NOT NULL, image BLOB NOT NULL UNIQUE);
         CREATE TABLE artwork_thumbnails (image_id INTEGER NOT NULL REFERENCES artwork_images(id) ON DELETE CASCADE, size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 4096), image BLOB NOT NULL, PRIMARY KEY (image_id, size));",
    ).unwrap();
    // Create the other business tables, without referencing the new digest index.
    connection
        .execute_batch(&crate::database::schema::definition().replace(
            "CREATE INDEX IF NOT EXISTS idx_artwork_images_digest ON artwork_images(digest);",
            "",
        ))
        .unwrap();
    connection.execute_batch("DROP TABLE inbox;").unwrap();
    if version == 4 {
        connection
            .execute_batch("DROP TABLE track_play_statistics;")
            .unwrap();
    }
    connection
        .pragma_update(None, "user_version", version)
        .unwrap();
}

#[test]
fn upgrades_previous_versions_preserving_originals_associations_and_sequences() {
    for version in [4, 5] {
        let mut connection = Connection::open_in_memory().unwrap();
        old_schema(&connection, version);
        connection.execute_batch("INSERT INTO tracks (id, path, title) VALUES (1, 'song.mp3', 'Song'); INSERT INTO skipped_tracks VALUES (1); INSERT INTO artwork_images VALUES (8, 'image/png', X'010203'); INSERT INTO track_artwork VALUES (1, 8, 'directory', '/offline/cover.png'); INSERT INTO artwork_thumbnails VALUES (8, 80, X'FF'); INSERT INTO artwork_images VALUES (99, 'image/png', X'09'); DELETE FROM artwork_images WHERE id = 99;").unwrap();
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
        assert_eq!(
            connection
                .query_row("SELECT image_id FROM track_artwork", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            8
        );
        let (image, digest): (Vec<u8>, Vec<u8>) = connection
            .query_row(
                "SELECT image, digest FROM artwork_images WHERE id = 8",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(image, [1, 2, 3]);
        assert_eq!(digest, Sha256::digest(&image).to_vec());
        connection
            .execute("INSERT INTO track_play_statistics VALUES (1, 1)", [])
            .unwrap();
        connection.execute("INSERT INTO artwork_images (mime_type, digest, image) VALUES ('image/png', ?1, X'FF')", [[0u8; 32].as_slice()]).unwrap();
        assert!(connection.last_insert_rowid() > 99);
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert!(connection
            .prepare("SELECT * FROM artwork_thumbnails")
            .is_err());
        assert!(!connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap());
        connection
            .execute("DELETE FROM track_artwork WHERE track_id = 1", [])
            .unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM artwork_images WHERE id = 8",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}

#[test]
fn migration_reclaims_old_thumbnail_and_blob_index_space_on_disk() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("library.sqlite3");
    let mut connection = Connection::open(&path).unwrap();
    old_schema(&connection, 5);
    let original = vec![13u8; 1024 * 1024];
    connection
        .execute(
            "INSERT INTO artwork_images VALUES (1, 'image/png', ?1)",
            [&original],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO artwork_thumbnails VALUES (1, 80, ?1)",
            [vec![7u8; 3 * 1024 * 1024]],
        )
        .unwrap();
    let before = std::fs::metadata(&path).unwrap().len();
    initialize_schema(&mut connection).unwrap();
    let after = std::fs::metadata(&path).unwrap().len();
    assert!(after < before / 2, "before={before} after={after}");
    assert_eq!(
        connection
            .pragma_query_value(None, "freelist_count", |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        connection
            .query_row("SELECT image FROM artwork_images", [], |row| row
                .get::<_, Vec<u8>>(0))
            .unwrap(),
        original
    );
}

#[test]
fn failed_migration_rolls_back_and_restores_foreign_key_enforcement() {
    let mut connection = Connection::open_in_memory().unwrap();
    old_schema(&connection, 5);
    connection.execute_batch("PRAGMA foreign_keys = OFF; INSERT INTO tracks (id, path) VALUES (1, 'song.mp3'); INSERT INTO track_artwork VALUES (1, 999, 'embedded', 'song.mp3'); PRAGMA foreign_keys = ON;").unwrap();
    assert!(initialize_schema(&mut connection).is_err());
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        5
    );
    assert_eq!(
        connection
            .pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(connection
        .prepare("SELECT * FROM artwork_thumbnails")
        .is_ok());
    assert!(connection
        .prepare("SELECT digest FROM artwork_images")
        .is_err());
}

#[test]
fn interrupted_space_reclamation_retries_without_changing_content_identity() {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_schema(&mut connection).unwrap();
    connection
        .execute(
            "INSERT INTO artwork_images (mime_type, digest, image) VALUES ('image/png', ?1, X'01')",
            [[0u8; 32].as_slice()],
        )
        .unwrap();
    let identity: String = connection
        .query_row("SELECT content_id FROM artwork_images", [], |row| {
            row.get(0)
        })
        .unwrap();
    connection.pragma_update(None, "user_version", 5).unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT content_id FROM artwork_images", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        identity
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
fn version_seven_adds_registration_dates_to_an_empty_inbox() {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_schema(&mut connection).unwrap();
    connection
        .execute_batch("DROP TABLE inbox; CREATE TABLE inbox (path TEXT PRIMARY KEY NOT NULL);")
        .unwrap();
    connection.pragma_update(None, "user_version", 7).unwrap();
    initialize_schema(&mut connection).unwrap();
    initialize_schema(&mut connection).unwrap();
    connection
        .execute(
            "INSERT INTO inbox (path, added_at) VALUES ('song.wav', 123)",
            [],
        )
        .unwrap();
    assert_eq!(
        connection
            .query_row("SELECT added_at FROM inbox", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        123
    );
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        SCHEMA_VERSION
    );
}

#[test]
fn version_six_adds_only_independent_inbox_paths_without_changing_library_snapshots() {
    let mut connection = Connection::open_in_memory().unwrap();
    initialize_schema(&mut connection).unwrap();
    connection.execute_batch("DROP TABLE inbox; INSERT INTO tracks (id, path, title) VALUES (1, 'song.wav', 'Stored');").unwrap();
    connection.pragma_update(None, "user_version", 6).unwrap();
    initialize_schema(&mut connection).unwrap();
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    assert_eq!(
        connection
            .query_row("SELECT title FROM tracks WHERE id = 1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "Stored"
    );
    let mut statement = connection.prepare("PRAGMA table_info(inbox)").unwrap();
    let columns: Vec<String> = statement
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(columns, ["path", "added_at"]);
    connection
        .execute(
            "INSERT INTO inbox (path, added_at) VALUES ('song.wav', 123)",
            [],
        )
        .unwrap();
    assert!(connection
        .execute(
            "INSERT INTO inbox (path, added_at) VALUES ('song.wav', 456)",
            []
        )
        .is_err());
    assert_eq!(
        connection
            .query_row("SELECT title FROM tracks WHERE id = 1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "Stored"
    );
}
