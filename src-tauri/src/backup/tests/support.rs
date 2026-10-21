use super::*;

use std::sync::atomic::{AtomicU64, Ordering};

static DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) struct Directory(pub(super) PathBuf);
impl Directory {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "newbee-backup-test-{}-{}",
            archive::nonce(),
            DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub(super) fn fixture(root: &Path) -> Database {
    let path = root.join("music-library.sqlite3");
    let database = Database::open(&path).unwrap();
    let connection = Connection::open(path).unwrap();
    connection.execute_batch(
        "INSERT INTO tracks (id, path, title, album, in_library) VALUES (1, 'C:\\Music\\missing.flac', 'song', 'album', 1);
         INSERT INTO skipped_tracks (track_id) VALUES (1);
         INSERT INTO playlists (id, name) VALUES (1, 'favorites');
         INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 1, 0);
         INSERT INTO track_lyrics (track_id, text) VALUES (1, 'lyrics');
         INSERT INTO artwork_images (id, mime_type, digest, image) VALUES (1, 'image/png', zeroblob(32), X'010203');
         INSERT INTO track_artwork (track_id, image_id, picture_type, is_display) VALUES (1, 1, 3, 1);
         INSERT INTO track_artwork_sources (artwork_id, source_kind, source_path, picture_type) VALUES (1, 'embedded', 'C:\\Music\\missing.flac', 3);"
    ).unwrap();
    database
}

pub(super) fn manifest() -> Manifest {
    let session: SavedSession = serde_json::from_value(serde_json::json!({
        "queue": {"displayedTracks": [{"trackId": 1, "rowKey": "row:1", "title": "song", "album": "album", "durationMs": 1000}],
            "currentRowKey": "row:1", "nextRowKeys": [], "shuffleEnabled": true, "repeatOneEnabled": false},
        "currentTrack": {"trackId": 1, "title": "song", "artist": "artist"},
        "volume": {"volume": 30, "lastNonMutedVolume": 30}
    })).unwrap();
    let interface = InterfaceState::from([
        ("newbee.active-page".into(), "Library".into()),
        ("newbee.playing-presentation".into(), "both".into()),
        ("newbee.playlist-selection".into(), "1".into()),
        (
            "newbee.sidebar-layout".into(),
            "{\"leftPaneWidth\":220}".into(),
        ),
        (
            "newbee.scroll-positions".into(),
            "{\"library:artists\":{\"top\":50,\"left\":0}}".into(),
        ),
    ]);
    Manifest::new(
        Settings {
            synchronization_folders: vec![crate::library::synchronization::configuration::Folder {
                path: "C:\\Music".into(),
                mode: crate::library::synchronization::configuration::Mode::Manual,
                enabled: true,
            }],
            ..Settings::default()
        },
        session,
        interface,
    )
}

pub(super) fn make_backup(root: &Path, destination: &Path) {
    let database = fixture(root);
    archive::write(&database, &manifest(), destination).unwrap();
}

pub(super) fn fixture_with_line_endings(root: &Path, ending: &str) -> Database {
    fixture_with_schema(root, |sql| sql.replace("\r\n", "\n").replace('\n', ending))
}

pub(super) fn fixture_with_schema(root: &Path, rewrite: impl Fn(&str) -> String) -> Database {
    let expected_file = root.join("expected.sqlite3");
    Database::open(":memory:")
        .unwrap()
        .backup_snapshot(&expected_file)
        .unwrap();
    let expected = Connection::open(expected_file).unwrap();
    let version: i64 = expected
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let mut statement = expected.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name").unwrap();
    let statements = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    let path = root.join("music-library.sqlite3");
    let connection = Connection::open(&path).unwrap();
    for sql in statements {
        connection
            .execute_batch(&rewrite(&sql.replace("\r\n", "\n")))
            .unwrap();
    }
    connection
        .pragma_update(None, "user_version", version)
        .unwrap();
    connection.execute_batch("INSERT INTO tracks (id, path, title, album, in_library) VALUES (1, '/missing/album/song.flac', 'restored song', 'album', 1), (2, '/missing/other/song.flac', 'other song', 'other', 1); INSERT INTO track_play_statistics VALUES (1, 3);").unwrap();
    drop(connection);
    Database::open(path).unwrap()
}

pub(super) fn rewrite_backup_schema(file: &Path, rewrite: impl Fn(&str) -> String) {
    let connection = Connection::open(file).unwrap();
    let objects = connection
        .prepare("SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != 'newbee_backup_manifest'")
        .unwrap()
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    connection
        .pragma_update(None, "writable_schema", true)
        .unwrap();
    for (name, sql) in objects {
        connection
            .execute(
                "UPDATE sqlite_schema SET sql = ?1 WHERE name = ?2",
                [rewrite(&sql), name],
            )
            .unwrap();
    }
    connection
        .pragma_update(None, "writable_schema", false)
        .unwrap();
    // Reopen to make SQLite parse the rewritten schema, rather than its cached metadata.
    drop(connection);
    let connection = Connection::open(file).unwrap();
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}
