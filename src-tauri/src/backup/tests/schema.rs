use super::*;
use crate::backup::restore;

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
            assert!(database.get_track(1).unwrap().is_some());
            assert!(!database
                .library_track_paths()
                .unwrap()
                .iter()
                .any(|path| path == "/missing/album/song.flac"));
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
        .replace(
            "TEXT NOT NULL UNIQUE",
            "TEXT NOT NULL UNIQUE ON CONFLICT ABORT",
        )
        .replace(
            "UNIQUE (track_id, image_id)",
            "UNIQUE (track_id, image_id) ON CONFLICT ABORT",
        )
        .replace(
            "UNIQUE (artwork_id, source_kind, source_path)",
            "UNIQUE (artwork_id, source_kind, source_path) ON CONFLICT ABORT",
        )
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
            return "CREATE TABLE track_artwork (id INTEGER PRIMARY KEY AUTOINCREMENT, track_id INTEGER NOT NULL, image_id INTEGER NOT NULL, picture_type INTEGER NOT NULL, is_display INTEGER DEFAULT 0 NOT NULL, source_error TEXT, CHECK (picture_type BETWEEN 0 AND 255), FOREIGN KEY (image_id) REFERENCES artwork_images(id), CHECK (is_display IN (0, 1)), FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE)".into();
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
