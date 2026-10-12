mod artwork;

use super::*;
use crate::playback::session::SavedSession;
use crate::settings::Settings;
use rusqlite::Connection;
use std::sync::atomic::{AtomicU64, Ordering};

static DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
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

#[test]
fn read_only_backup_can_be_copied_and_restored_without_changing_source_permissions() {
    let source = Directory::new();
    let target = Directory::new();
    let file = source.0.join("read-only.newbee");
    make_backup(&source.0, &file);
    let original_permissions = fs::metadata(&file).unwrap().permissions();
    let mut read_only = original_permissions.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&file, read_only).unwrap();
    let copied = archive::copy_synced(&file, &target.0.join(restore::PENDING_FILE));
    assert!(fs::metadata(&file).unwrap().permissions().readonly());
    fs::set_permissions(&file, original_permissions).unwrap();
    copied.unwrap();
    assert!(apply_pending_restore(&target.0).unwrap());
    assert!(file.exists());
}

#[test]
fn data_directory_is_exclusively_locked_until_the_application_releases_it() {
    let directory = Directory::new();
    let first = lock_data_directory(&directory.0).unwrap();
    assert!(lock_data_directory(&directory.0).is_err());
    drop(first);
    assert!(lock_data_directory(&directory.0).is_ok());
}

#[test]
fn snapshots_committed_wal_data_without_copying_live_sidecars() {
    let directory = Directory::new();
    let database = fixture(&directory.0);
    let connection = Connection::open(directory.0.join("music-library.sqlite3")).unwrap();
    connection.execute_batch("PRAGMA journal_mode = WAL; INSERT INTO tracks (path, title) VALUES ('/new.flac', 'new song');").unwrap();
    assert!(directory.0.join("music-library.sqlite3-wal").exists());
    let destination = directory.0.join("wal.newbee");
    archive::write(&database, &manifest(), &destination).unwrap();
    archive::read(&destination).unwrap();
    let snapshot = Connection::open(&destination).unwrap();
    let count: i64 = snapshot
        .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 2);
    assert!(!directory.0.join("wal.newbee-wal").exists());
}

#[cfg(windows)]
#[test]
fn file_replacement_failure_preserves_original_data_and_recovers_on_next_start() {
    use std::os::windows::fs::OpenOptionsExt;
    let source = Directory::new();
    let target = Directory::new();
    let file = source.0.join("backup.newbee");
    make_backup(&source.0, &file);
    let original = fixture(&target.0);
    original.close_test_connection();
    let connection = Connection::open(target.0.join("music-library.sqlite3")).unwrap();
    connection
        .execute("UPDATE tracks SET title = 'original song'", [])
        .unwrap();
    drop(connection);
    fs::write(target.0.join("settings.json"), "original settings").unwrap();
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(target.0.join("settings.json"))
        .unwrap();
    assert!(apply_pending_restore(&target.0).is_err());
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original settings"
    );
    drop(locked);
    assert!(!apply_pending_restore(&target.0).unwrap());
    let restored = Database::open(target.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("original song")
    );
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original settings"
    );
    assert!(!target.0.join("playback-session.json").exists());
}

fn fixture(root: &Path) -> Database {
    let path = root.join("music-library.sqlite3");
    let database = Database::open(&path).unwrap();
    let connection = Connection::open(path).unwrap();
    connection.execute_batch(
        "INSERT INTO tracks (id, path, title, album) VALUES (1, 'C:\\Music\\missing.flac', 'song', 'album');
         INSERT INTO music_library_directories (path) VALUES ('C:\\Music');
         INSERT INTO skipped_tracks (track_id) VALUES (1);
         INSERT INTO playlists (id, name) VALUES (1, 'favorites');
         INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 1, 0);
         INSERT INTO track_lyrics (track_id, text) VALUES (1, 'lyrics');
         INSERT INTO artwork_images (id, mime_type, digest, image) VALUES (1, 'image/png', zeroblob(32), X'010203');
         INSERT INTO track_artwork (track_id, image_id, source_kind, source_path) VALUES (1, 1, 'embedded', 'C:\\Music\\missing.flac');"
    ).unwrap();
    database
}

fn manifest() -> Manifest {
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
    Manifest::new(Settings::default(), session, interface)
}

fn make_backup(root: &Path, destination: &Path) {
    let database = fixture(root);
    archive::write(&database, &manifest(), destination).unwrap();
}

fn fixture_with_line_endings(root: &Path, ending: &str) -> Database {
    fixture_with_schema(root, |sql| sql.replace("\r\n", "\n").replace('\n', ending))
}

fn fixture_with_schema(root: &Path, rewrite: impl Fn(&str) -> String) -> Database {
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
    connection.execute_batch("INSERT INTO tracks (id, path, title, album) VALUES (1, '/missing/album/song.flac', 'restored song', 'album'), (2, '/missing/other/song.flac', 'other song', 'other'); INSERT INTO track_play_statistics VALUES (1, 3);").unwrap();
    drop(connection);
    Database::open(path).unwrap()
}

fn rewrite_backup_schema(file: &Path, rewrite: impl Fn(&str) -> String) {
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

#[test]
fn equivalent_schema_spelling_can_be_imported_and_restores_deleted_album() {
    for quote in ["", "\"", "`", "["] {
        for ending in ["\n", "\r\n"] {
            let directory = Directory::new();
            let database = fixture_with_line_endings(&directory.0, ending);
            let exported = directory.0.join("equivalent.newbee");
            let current = Manifest::new(
                Settings::default(),
                SavedSession::default(),
                InterfaceState::new(),
            );
            archive::write(&database, &current, &exported).unwrap();
            rewrite_backup_schema(&exported, |sql| {
                let mut sql = sql.replace("\r\n", "\n");
                for keyword in [
                    "CREATE",
                    "TABLE",
                    "INDEX",
                    "TRIGGER",
                    "INTEGER",
                    "TEXT",
                    "BLOB",
                    "PRIMARY",
                    "KEY",
                    "AUTOINCREMENT",
                    "NOT",
                    "NULL",
                    "UNIQUE",
                    "REFERENCES",
                    "ON",
                    "DELETE",
                    "CASCADE",
                    "CHECK",
                    "IN",
                    "DEFAULT",
                    "BETWEEN",
                    "AND",
                    "OR",
                    "IS",
                    "AFTER",
                    "UPDATE",
                    "OF",
                    "WHEN",
                    "BEGIN",
                    "FROM",
                    "WHERE",
                    "EXISTS",
                    "SELECT",
                    "END",
                ] {
                    sql = sql.replace(keyword, &keyword.to_ascii_lowercase());
                }
                for identifier in [
                    "id",
                    "path",
                    "title",
                    "artist",
                    "album",
                    "album_artist",
                    "release_date",
                    "disc_number",
                    "track_number",
                    "disc_total",
                    "track_total",
                    "duration_ms",
                    "codec",
                    "sample_rate_hz",
                    "bitrate_kbps",
                    "channels",
                    "text",
                    "size",
                    "image",
                    "mime_type",
                    "source_path",
                    "name",
                    "position",
                    "playlist_id",
                    "snapshot",
                    "scan_issue",
                    "image_id",
                    "track_id",
                    "play_count",
                    "no_lyrics",
                    "source_kind",
                    "track_artwork",
                    "artwork_images",
                    "tracks",
                    "track_lyrics",
                    "skipped_tracks",
                    "digest",
                    "content_id",
                    "idx_artwork_images_digest",
                    "music_library_directories",
                    "playlists",
                    "playlist_items",
                    "track_editing",
                    "track_play_statistics",
                    "idx_tracks_album_artist_album",
                    "idx_playlist_items_playlist_position",
                    "idx_playlist_items_track",
                    "remove_unreferenced_artwork_after_delete",
                    "remove_unreferenced_artwork_after_replace",
                    "OLD",
                    "NEW",
                ] {
                    let close = if quote == "[" { "]" } else { quote };
                    sql = regex::Regex::new(&format!(r"\b{identifier}\b"))
                        .unwrap()
                        .replace_all(
                            &sql,
                            format!("{quote}{}{close}", identifier.to_ascii_uppercase()),
                        )
                        .into_owned();
                }
                sql.replace(',', " ,\n\t")
                    .replace("(", "( ")
                    .replace(")", " )")
                    .replace('\n', ending)
            });
            database.remove_track_from_library(1).unwrap();
            assert!(database.get_track(1).unwrap().is_none());
            archive::read(&exported).unwrap();
            restore::stage(&directory.0, &database, Some(&current), &exported).unwrap();
            database.close_test_connection();
            assert!(apply_pending_restore(&directory.0).unwrap());
            let restored = Database::open(directory.0.join("music-library.sqlite3")).unwrap();
            assert_eq!(
                restored.get_track(1).unwrap().unwrap().title(),
                Some("restored song")
            );
            assert_eq!(
                restored.get_track(2).unwrap().unwrap().title(),
                Some("other song")
            );
            let connection = Connection::open(directory.0.join("music-library.sqlite3")).unwrap();
            let count: i64 = connection
                .query_row(
                    "SELECT play_count FROM track_play_statistics WHERE track_id = 1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 3);
        }
    }
}

#[test]
fn schema_comments_parentheses_and_explicit_defaults_do_not_change_compatibility() {
    let directory = Directory::new();
    let database = fixture_with_schema(&directory.0, |sql| {
        sql.replace(
            "INTEGER PRIMARY KEY",
            "\"integer\" CONSTRAINT [primary] PRIMARY KEY ASC ON CONFLICT ABORT",
        )
        .replace("NOT NULL", "NOT NULL ON CONFLICT ABORT")
        .replace("UNIQUE", "UNIQUE ON CONFLICT ABORT")
        .replace(
            "CHECK (play_count > 0)",
            "CONSTRAINT `count` CHECK (((play_count) > (0)))",
        )
        .replace("DEFAULT 0", "DEFAULT (0)")
        .replace(
            "ON tracks(album_artist, album)",
            "ON tracks(album_artist ASC, album ASC)",
        )
        .replace(
            "AFTER DELETE ON track_artwork",
            "AFTER DELETE ON track_artwork FOR EACH ROW",
        )
        .replace("CREATE TABLE", "CREATE /* table */ TABLE IF NOT EXISTS")
    });
    let exported = directory.0.join("defaults.newbee");
    archive::write(
        &database,
        &Manifest::new(
            Settings::default(),
            SavedSession::default(),
            InterfaceState::new(),
        ),
        &exported,
    )
    .unwrap();
    archive::read(&exported).unwrap();
}

#[test]
fn explicit_foreign_key_defaults_match_sqlite_effective_semantics() {
    for defer in [
        "NOT DEFERRABLE",
        "NOT DEFERRABLE INITIALLY DEFERRED",
        "DEFERRABLE",
        "DEFERRABLE INITIALLY IMMEDIATE",
    ] {
        let directory = Directory::new();
        let database = fixture_with_schema(&directory.0, |sql| {
            sql.replace(
                "ON DELETE CASCADE",
                &format!("ON UPDATE NO ACTION ON DELETE CASCADE {defer}"),
            )
        });
        let exported = directory.0.join("foreign-key-defaults.newbee");
        archive::write(
            &database,
            &Manifest::new(
                Settings::default(),
                SavedSession::default(),
                InterfaceState::new(),
            ),
            &exported,
        )
        .unwrap();
        if let Err(error) = archive::read(&exported) {
            panic!("{defer}: {error}");
        }
    }
}

#[test]
fn inline_table_constraints_and_declaration_order_restore_the_same_structure() {
    let directory = Directory::new();
    let database = fixture_with_schema(&directory.0, |sql| {
        if sql.starts_with("CREATE TABLE track_lyrics ") {
            return "CREATE TABLE track_lyrics (track_id INTEGER, text TEXT, no_lyrics INTEGER DEFAULT 0 CHECK (text IS NULL OR no_lyrics = 0) NOT NULL, FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE, CHECK (no_lyrics IN (0, 1)), PRIMARY KEY (track_id))".into();
        }
        if sql.starts_with("CREATE TABLE track_artwork ") {
            return "CREATE TABLE track_artwork (track_id INTEGER, image_id INTEGER NOT NULL, source_kind TEXT NOT NULL, source_path TEXT NOT NULL, CHECK (source_kind IN ('embedded', 'directory')), FOREIGN KEY (image_id) REFERENCES artwork_images(id), PRIMARY KEY (track_id), FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE)".into();
        }
        if sql.starts_with("CREATE TABLE tracks ") {
            return sql
                .replace("path TEXT NOT NULL UNIQUE", "path TEXT NOT NULL")
                .replace("channels INTEGER", "channels INTEGER, UNIQUE (path)");
        }
        sql.into()
    });
    let exported = directory.0.join("constraint-layout.newbee");
    let current = Manifest::new(
        Settings::default(),
        SavedSession::default(),
        InterfaceState::new(),
    );
    archive::write(&database, &current, &exported).unwrap();
    database.remove_track_from_library(1).unwrap();
    archive::read(&exported).unwrap();
    restore::stage(&directory.0, &database, Some(&current), &exported).unwrap();
    database.close_test_connection();
    assert!(apply_pending_restore(&directory.0).unwrap());
    let restored = Database::open(directory.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("restored song")
    );
}

#[test]
fn incompatible_schema_is_rejected_before_staging_or_replacing_original_data() {
    let changes = [
        ("column", "title TEXT", "title TEXT, unexpected TEXT"),
        ("type", "duration_ms INTEGER", "duration_ms TEXT"),
        ("not null", "position INTEGER NOT NULL", "position INTEGER"),
        (
            "not null conflict",
            "position INTEGER NOT NULL",
            "position INTEGER NOT NULL ON CONFLICT IGNORE",
        ),
        (
            "column collation",
            "source_path TEXT NOT NULL",
            "source_path TEXT COLLATE NOCASE NOT NULL",
        ),
        ("autoincrement", "PRIMARY KEY AUTOINCREMENT", "PRIMARY KEY"),
        (
            "rowid alias",
            "track_id INTEGER PRIMARY KEY REFERENCES tracks(id)",
            "track_id INTEGER PRIMARY KEY DESC REFERENCES tracks(id)",
        ),
        ("default", "DEFAULT 0", "DEFAULT 1"),
        (
            "digest index column",
            "ON artwork_images(digest)",
            "ON artwork_images(content_id)",
        ),
        (
            "primary key conflict",
            "track_id INTEGER PRIMARY KEY REFERENCES",
            "track_id INTEGER PRIMARY KEY ON CONFLICT REPLACE REFERENCES",
        ),
        (
            "primary key removed",
            "track_id INTEGER PRIMARY KEY REFERENCES",
            "track_id INTEGER UNIQUE REFERENCES",
        ),
        (
            "foreign key target",
            "REFERENCES artwork_images(id)",
            "REFERENCES playlists(id)",
        ),
        ("delete action", "ON DELETE CASCADE", "ON DELETE RESTRICT"),
        (
            "update action",
            "REFERENCES artwork_images(id)",
            "REFERENCES artwork_images(id) ON UPDATE CASCADE",
        ),
        (
            "deferred foreign key",
            "REFERENCES tracks(id) ON DELETE CASCADE",
            "REFERENCES tracks(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED",
        ),
        ("unique", "path TEXT NOT NULL UNIQUE", "path TEXT NOT NULL"),
        (
            "conflict policy",
            "path TEXT NOT NULL UNIQUE",
            "path TEXT NOT NULL UNIQUE ON CONFLICT REPLACE",
        ),
        (
            "index order",
            "ON tracks(album_artist, album)",
            "ON tracks(album, album_artist)",
        ),
        (
            "index uniqueness",
            "CREATE INDEX idx_tracks_album_artist_album",
            "CREATE UNIQUE INDEX idx_tracks_album_artist_album",
        ),
        (
            "index direction",
            "ON tracks(album_artist, album)",
            "ON tracks(album_artist DESC, album)",
        ),
        (
            "index collation",
            "ON tracks(album_artist, album)",
            "ON tracks(album_artist COLLATE NOCASE, album)",
        ),
        (
            "index expression",
            "ON tracks(album_artist, album)",
            "ON tracks(lower(album_artist), album)",
        ),
        (
            "partial index",
            "ON tracks(album_artist, album)",
            "ON tracks(album_artist, album) WHERE album IS NOT NULL",
        ),
        (
            "check column",
            "CHECK (play_count > 0)",
            "CHECK (play_count >= 0)",
        ),
        (
            "check table",
            "CHECK (text IS NULL OR no_lyrics = 0)",
            "CHECK (text IS NULL OR no_lyrics = 1)",
        ),
        (
            "check precedence",
            "CHECK (text IS NULL OR no_lyrics = 0)",
            "CHECK ((text IS NULL OR no_lyrics) = 0)",
        ),
        ("check literal case", "'embedded'", "'Embedded'"),
        (
            "double quoted literal fallback",
            "'embedded'",
            "\"Embedded\"",
        ),
        ("check literal escaping", "'embedded'", "'em''bedded'"),
        ("check literal whitespace", "'embedded'", "'embedded '"),
        ("check bound", "length(digest) = 32", "length(digest) = 31"),
        (
            "trigger timing",
            "AFTER DELETE ON track_artwork",
            "BEFORE DELETE ON track_artwork",
        ),
        (
            "trigger event",
            "AFTER UPDATE OF image_id",
            "AFTER UPDATE OF source_kind",
        ),
        (
            "trigger condition",
            "WHEN OLD.image_id != NEW.image_id",
            "WHEN OLD.image_id = NEW.image_id",
        ),
        (
            "trigger body",
            "WHERE id = OLD.image_id",
            "WHERE id = NEW.image_id",
        ),
        ("trigger extra command", "BEGIN", "BEGIN SELECT 1;"),
    ];
    for (label, before, after) in changes {
        let source = Directory::new();
        let target = Directory::new();
        let original = fixture(&target.0);
        fs::write(target.0.join("settings.json"), "original settings").unwrap();
        let database = fixture_with_schema(&source.0, |sql| {
            sql.replace(before, after).replace('\n', "\r\n")
        });
        let exported = source.0.join("incompatible.newbee");
        let current = Manifest::new(
            Settings::default(),
            SavedSession::default(),
            InterfaceState::new(),
        );
        archive::write(&database, &current, &exported).unwrap();
        let bytes = fs::read(target.0.join("music-library.sqlite3")).unwrap();
        let snapshot = Connection::open(&exported).unwrap();
        let integrity: String = snapshot
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok", "{label}");
        assert!(
            !snapshot
                .prepare("PRAGMA foreign_key_check")
                .unwrap()
                .exists([])
                .unwrap(),
            "{label}"
        );
        drop(snapshot);
        // The exact error proves these cases reached the compatibility comparison,
        // not manifest validation, SQL parsing, integrity or association failures.
        assert_eq!(
            archive::read(&exported).err().unwrap(),
            "备份数据库与当前版本不兼容",
            "{label}"
        );
        assert_eq!(
            restore::stage(&target.0, &original, Some(&current), &exported).unwrap_err(),
            "备份数据库与当前版本不兼容",
            "{label}"
        );
        assert!(!target.0.join(restore::PENDING_FILE).exists(), "{label}");
        assert!(!target.0.join("backups").exists(), "{label}");
        fs::copy(&exported, target.0.join(restore::PENDING_FILE)).unwrap();
        original.close_test_connection();
        assert!(apply_pending_restore(&target.0).is_err(), "{label}");
        assert_eq!(
            fs::read(target.0.join("music-library.sqlite3")).unwrap(),
            bytes,
            "{label}"
        );
        assert_eq!(
            fs::read_to_string(target.0.join("settings.json")).unwrap(),
            "original settings",
            "{label}"
        );
        let unchanged = Database::open(target.0.join("music-library.sqlite3")).unwrap();
        assert_eq!(
            unchanged.get_track(1).unwrap().unwrap().title(),
            Some("song"),
            "{label}"
        );
    }
}

#[test]
fn snapshot_round_trip_includes_database_settings_session_and_interface_without_music() {
    let source = Directory::new();
    let destination = Directory::new();
    let file = source.0.join("backup.newbee");
    make_backup(&source.0, &file);
    let saved = archive::read(&file).unwrap();
    assert_eq!(saved.settings, Settings::default());
    assert_eq!(saved.interface, manifest().interface);
    assert_eq!(saved.session.current_track.unwrap().track_id, Some(1));
    let queue = serde_json::to_value(saved.session.queue).unwrap();
    assert_eq!(queue["currentRowKey"], "row:1");
    assert_eq!(queue["shuffleEnabled"], true);
    assert_eq!(queue["displayedTracks"][0]["trackId"], 1);
    let connection = Connection::open(&file).unwrap();
    let artwork: Vec<u8> = connection
        .query_row("SELECT image FROM artwork_images", [], |row| row.get(0))
        .unwrap();
    assert_eq!(artwork, [1, 2, 3]);
    drop(connection);
    fs::copy(&file, destination.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&destination.0).unwrap());
    let interface: InterfaceState =
        serde_json::from_slice(&fs::read(destination.0.join(restore::INTERFACE_FILE)).unwrap())
            .unwrap();
    assert_eq!(interface, manifest().interface);
    fs::remove_file(destination.0.join(restore::INTERFACE_FILE)).unwrap();
    assert!(!apply_pending_restore(&destination.0).unwrap());
    let restored = Database::open(destination.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert_eq!(restored.list_playlist_tracks(1).unwrap().len(), 1);
    assert_eq!(
        restored.list_music_library_directories().unwrap()[0].path,
        "C:\\Music"
    );
    let connection = Connection::open(destination.0.join("music-library.sqlite3")).unwrap();
    let count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'newbee_backup_manifest'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    let session: serde_json::Value =
        serde_json::from_slice(&fs::read(destination.0.join("playback-session.json")).unwrap())
            .unwrap();
    assert_eq!(session["currentTrack"]["trackId"], 1);
    assert!(session.get("positionMs").is_none());
    assert!(session.get("isPlaying").is_none());
    assert_eq!(session["volume"]["volume"], 30);
    assert!(!destination.0.join("C:\\Music\\missing.flac").exists());
}

#[test]
fn rejects_incompatible_versions_corruption_unknown_state_and_schema_changes() {
    let directory = Directory::new();
    let file = directory.0.join("backup.newbee");
    make_backup(&directory.0, &file);
    let mut saved = manifest();
    saved.format_version += 1;
    let connection = Connection::open(&file).unwrap();
    connection
        .execute(
            "UPDATE newbee_backup_manifest SET json = ?1",
            [serde_json::to_string(&saved).unwrap()],
        )
        .unwrap();
    assert!(archive::read(&file).err().unwrap().contains("不兼容"));
    saved = manifest();
    saved.app_version = "99.0.0".into();
    connection
        .execute(
            "UPDATE newbee_backup_manifest SET json = ?1",
            [serde_json::to_string(&saved).unwrap()],
        )
        .unwrap();
    assert!(archive::read(&file).err().unwrap().contains("不兼容"));
    saved = manifest();
    saved
        .interface
        .insert("window.position".into(), "{}".into());
    connection
        .execute(
            "UPDATE newbee_backup_manifest SET json = ?1",
            [serde_json::to_string(&saved).unwrap()],
        )
        .unwrap();
    assert!(archive::read(&file).err().unwrap().contains("未知界面"));
    connection
        .execute(
            "UPDATE newbee_backup_manifest SET json = ?1",
            [serde_json::to_string(&manifest()).unwrap()],
        )
        .unwrap();
    connection
        .execute_batch("CREATE TABLE unexpected (value TEXT);")
        .unwrap();
    assert!(archive::read(&file).err().unwrap().contains("不兼容"));
    drop(connection);
    fs::write(&file, "not a database").unwrap();
    assert!(archive::read(&file).is_err());
}

#[test]
fn rejects_invalid_relations_and_session_before_modifying_original_data() {
    let source = Directory::new();
    let target = Directory::new();
    fs::write(target.0.join("settings.json"), "original").unwrap();
    let file = source.0.join("backup.newbee");
    make_backup(&source.0, &file);
    let connection = Connection::open(&file).unwrap();
    connection
        .execute_batch("PRAGMA foreign_keys = OFF;")
        .unwrap();
    connection
        .execute(
            "INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (99, 99, 0)",
            [],
        )
        .unwrap();
    drop(connection);
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&target.0).is_err());
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original"
    );
    let mut invalid = manifest();
    invalid.session.volume.volume = 101;
    assert!(invalid.validate().is_err());
}

#[test]
fn interrupted_partial_restore_rolls_back_original_files_and_missing_files() {
    let directory = Directory::new();
    let rollback = directory.0.join(restore::rollback_directory());
    fs::create_dir(&rollback).unwrap();
    fs::write(rollback.join("settings.json"), "original-settings").unwrap();
    fs::write(rollback.join("music-library.sqlite3"), "original-db").unwrap();
    fs::write(
        rollback.join("prepared.json"),
        "[\"settings.json\",\"music-library.sqlite3\"]",
    )
    .unwrap();
    fs::write(directory.0.join("settings.json"), "imported-settings").unwrap();
    fs::write(directory.0.join("music-library.sqlite3"), "imported-db").unwrap();
    fs::write(
        directory.0.join("playback-session.json"),
        "imported-session",
    )
    .unwrap();
    fs::write(directory.0.join(restore::PENDING_FILE), "pending").unwrap();
    assert!(!apply_pending_restore(&directory.0).unwrap());
    assert_eq!(
        fs::read_to_string(directory.0.join("settings.json")).unwrap(),
        "original-settings"
    );
    assert_eq!(
        fs::read_to_string(directory.0.join("music-library.sqlite3")).unwrap(),
        "original-db"
    );
    assert!(!directory.0.join("playback-session.json").exists());
    assert!(!directory.0.join(restore::PENDING_FILE).exists());
}

#[test]
fn completed_restore_cleanup_does_not_reapply_pending_or_touch_automatic_backups() {
    let directory = Directory::new();
    let rollback = directory.0.join(restore::rollback_directory());
    fs::create_dir(&rollback).unwrap();
    fs::create_dir(directory.0.join("backups")).unwrap();
    fs::write(directory.0.join("backups/before.newbee"), "safety-backup").unwrap();
    fs::write(rollback.join("committed"), "complete").unwrap();
    fs::write(directory.0.join("settings.json"), "restored-settings").unwrap();
    fs::write(directory.0.join(restore::PENDING_FILE), "pending").unwrap();
    assert!(apply_pending_restore(&directory.0).unwrap());
    assert_eq!(
        fs::read_to_string(directory.0.join("settings.json")).unwrap(),
        "restored-settings"
    );
    assert_eq!(
        fs::read_to_string(directory.0.join("backups/before.newbee")).unwrap(),
        "safety-backup"
    );
    assert!(!rollback.exists());
}

#[test]
fn staging_restore_saves_original_data_first_and_keeps_the_backup_after_restore() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    let connection = Connection::open(target.0.join("music-library.sqlite3")).unwrap();
    connection
        .execute("UPDATE tracks SET title = 'original song'", [])
        .unwrap();
    drop(connection);
    let mut current = manifest();
    current.settings.accent_color = "#ff0000".into();
    current
        .interface
        .insert("newbee.active-page".into(), "Playlist".into());
    restore::stage(&target.0, &original, Some(&current), &imported).unwrap();
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("original song")
    );
    let backups = fs::read_dir(target.0.join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let safety = archive::read(&backups[0]).unwrap();
    assert_eq!(safety.settings.accent_color, "#ff0000");
    assert_eq!(safety.interface["newbee.active-page"], "Playlist");
    let connection = Connection::open(&backups[0]).unwrap();
    let title: String = connection
        .query_row("SELECT title FROM tracks WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "original song");
    drop(connection);
    original.close_test_connection();
    assert!(apply_pending_restore(&target.0).unwrap());
    let restored = Database::open(target.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert!(backups[0].exists());
    archive::read(&backups[0]).unwrap();
}

#[test]
fn automatic_backup_failure_does_not_stage_or_change_the_original() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    fs::write(target.0.join("backups"), "occupied").unwrap();
    assert!(restore::stage(&target.0, &original, Some(&manifest()), &imported).is_err());
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert!(!target.0.join(restore::PENDING_FILE).exists());
    assert!(!target.0.join("settings.json").exists());
    assert!(!target.0.join("playback-session.json").exists());
    assert!(!target.0.join(restore::INTERFACE_FILE).exists());
}

#[test]
fn restore_without_safety_backup_does_not_access_backup_directory() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    let connection = Connection::open(target.0.join("music-library.sqlite3")).unwrap();
    connection
        .execute("UPDATE tracks SET title = 'original song'", [])
        .unwrap();
    drop(connection);
    fs::write(target.0.join("backups"), "occupied").unwrap();
    restore::stage(&target.0, &original, None, &imported).unwrap();
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("original song")
    );
    original.close_test_connection();
    assert!(apply_pending_restore(&target.0).unwrap());
    let restored = Database::open(target.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert_eq!(
        fs::read_to_string(target.0.join("backups")).unwrap(),
        "occupied"
    );
}

#[test]
fn skipping_safety_backup_still_validates_import_before_changing_original_data() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    let connection = Connection::open(&imported).unwrap();
    connection
        .execute_batch("ALTER TABLE tracks ADD COLUMN unexpected TEXT;")
        .unwrap();
    drop(connection);
    fs::write(target.0.join("settings.json"), "original settings").unwrap();
    assert!(restore::stage(&target.0, &original, None, &imported).is_err());
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original settings"
    );
    assert!(!target.0.join("backups").exists());
    assert!(!target.0.join(restore::PENDING_FILE).exists());
}

#[test]
fn protects_application_files_from_export_overwrites() {
    let directory = Directory::new();
    fs::write(directory.0.join("settings.json"), "original").unwrap();
    assert!(validate_export_destination(&directory.0, &directory.0.join("settings.json")).is_err());
    fs::create_dir(directory.0.join("backups")).unwrap();
    assert!(
        validate_export_destination(&directory.0, &directory.0.join("backups/safety.newbee"))
            .is_ok()
    );
}
