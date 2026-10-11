use super::*;

fn database(paths: &[&str]) -> Database {
    let database = Database::open(":memory:").unwrap();
    for path in paths {
        database
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO tracks (path, title) VALUES (?1, 'title')",
                [path],
            )
            .unwrap();
    }
    database
}

fn paths(database: &Database) -> Vec<String> {
    let connection = database.connection().unwrap();
    let mut statement = connection
        .prepare("SELECT path FROM tracks ORDER BY id")
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn matches_directory_boundaries_and_preserves_suffixes() {
    let database = database(&[
        "/旧音乐/专辑/曲目.flac",
        "/旧音乐备份/song.mp3",
        "/other/旧音乐/song.mp3",
        "/旧音乐",
    ]);
    assert_eq!(
        database
            .migrate_library_paths("/旧音乐", "/新音乐")
            .unwrap(),
        2
    );
    assert_eq!(
        paths(&database),
        [
            "/新音乐/专辑/曲目.flac",
            "/旧音乐备份/song.mp3",
            "/other/旧音乐/song.mp3",
            "/新音乐",
        ]
    );
}

#[test]
fn treats_sql_wildcards_and_quotes_as_literal_characters() {
    let database = database(&["/a%_'/song.flac", "/abcd/song.flac"]);
    assert_eq!(database.migrate_library_paths("/a%_'", "/new").unwrap(), 1);
    assert_eq!(paths(&database), ["/new/song.flac", "/abcd/song.flac"]);
}

#[test]
fn handles_windows_drive_and_unc_canonical_paths() {
    let database = database(&[r"\\?\C:\音乐\a.flac", r"\\?\UNC\server\share\a.flac"]);
    assert_eq!(
        database
            .migrate_library_paths("C:/音乐/", "D:/Music/")
            .unwrap(),
        1
    );
    assert_eq!(
        database
            .migrate_library_paths(r"\\server\share", r"\\other\music")
            .unwrap(),
        1
    );
    assert_eq!(
        paths(&database),
        [r"\\?\D:\Music\a.flac", r"\\?\UNC\other\music\a.flac"]
    );
}

#[test]
fn matches_noncanonical_windows_paths_too() {
    let database = database(&[r"C:\Music\a.flac"]);
    assert_eq!(
        database
            .migrate_library_paths(r"C:\Music", r"D:\Music")
            .unwrap(),
        1
    );
    assert_eq!(paths(&database), [r"\\?\D:\Music\a.flac"]);
}

#[test]
fn supports_overlapping_prefixes_without_transient_collisions() {
    let database = database(&["/a/song.flac", "/a/nested/song.flac"]);
    assert_eq!(
        database.migrate_library_paths("/a/", "/a/nested/").unwrap(),
        2
    );
    assert_eq!(
        paths(&database),
        ["/a/nested/song.flac", "/a/nested/nested/song.flac"]
    );
}

#[test]
fn unrelated_equivalent_windows_paths_do_not_block_migration() {
    let database = database(&[r"C:\Music\a.flac", r"\\?\C:\Music\a.flac", "/old/song.flac"]);
    assert_eq!(
        database.migrate_library_paths("/missing", "/new").unwrap(),
        0
    );
    assert_eq!(database.migrate_library_paths("/old", "/new").unwrap(), 1);
    assert_eq!(paths(&database)[2], "/new/song.flac");
}

#[test]
fn rejects_equivalent_windows_destination_paths() {
    let database = database(&[r"C:\Music\a.flac", r"D:\Music\a.flac"]);
    assert!(database
        .migrate_library_paths(r"C:\Music", r"D:\Music")
        .is_err());
    assert_eq!(paths(&database), [r"C:\Music\a.flac", r"D:\Music\a.flac"]);
}

#[test]
fn matches_case_sensitively_and_preserves_filename_whitespace() {
    let database = database(&["/old/song.flac ", "/Old/song.flac"]);
    assert_eq!(database.migrate_library_paths("/old", "/new").unwrap(), 1);
    assert_eq!(paths(&database), ["/new/song.flac ", "/Old/song.flac"]);
}

#[test]
fn rejects_conflicts_without_partial_changes() {
    let database = database(&["/old/a.flac", "/old/b.flac", "/new/b.flac"]);
    assert!(database
        .migrate_library_paths("/old", "/new")
        .unwrap_err()
        .contains("冲突"));
    assert_eq!(
        paths(&database),
        ["/old/a.flac", "/old/b.flac", "/new/b.flac"]
    );
}

#[test]
fn rolls_back_when_an_update_fails() {
    let database = database(&["/old/a.flac", "/old/b.flac"]);
    database
        .connection()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_migration BEFORE UPDATE OF path ON tracks
         WHEN NEW.path = '/new/b.flac'
         BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        )
        .unwrap();
    assert!(database.migrate_library_paths("/old", "/new").is_err());
    assert_eq!(paths(&database), ["/old/a.flac", "/old/b.flac"]);
}

#[test]
fn migrates_sources_and_directories_without_changing_library_relationships() {
    let database = database(&["/old/song.flac"]);
    {
        let connection = database.connection().unwrap();
        connection.execute_batch(
            "INSERT INTO playlists (id, name) VALUES (1, 'playlist');
             INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 1, 0);
             INSERT INTO artwork_images (mime_type, digest, image) VALUES ('image/png', zeroblob(32), X'0102');
             INSERT INTO track_artwork (track_id, image_id, source_kind, source_path) VALUES (1, 1, 'embedded', '/old/song.flac');
             INSERT INTO music_library_directories (path) VALUES ('/old');",
        ).unwrap();
    }
    assert_eq!(database.migrate_library_paths("/old", "/new").unwrap(), 3);
    let details = database.get_track(1).unwrap().unwrap();
    assert_eq!(details.path(), "/new/song.flac");
    assert_eq!(details.title.as_deref(), Some("title"));
    assert_eq!(database.list_playlist_tracks(1).unwrap()[0].track_id, 1);
    assert!(matches!(
        database.get_track_artwork(1).unwrap(),
        Some(crate::artwork::model::TrackArtwork::Available { .. })
    ));
    assert_eq!(
        database.list_music_library_directories().unwrap()[0].path,
        "/new"
    );
    let source: String = database
        .connection()
        .unwrap()
        .query_row("SELECT source_path FROM track_artwork", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(source, "/new/song.flac");
}

#[test]
fn converts_windows_suffixes_to_unix_and_back() {
    let database = database(&[r"\\?\C:\Music\专辑\song.flac", r"C:\Music-old\other.flac"]);
    assert_eq!(
        database
            .migrate_library_paths("C:/Music/", "/home/me/Music/")
            .unwrap(),
        1
    );
    assert_eq!(paths(&database)[0], "/home/me/Music/专辑/song.flac");
    assert_eq!(paths(&database)[1], r"C:\Music-old\other.flac");
    assert_eq!(
        database
            .migrate_library_paths("/home/me/Music", "D:/Music")
            .unwrap(),
        1
    );
    assert_eq!(paths(&database)[0], r"\\?\D:\Music\专辑\song.flac");
}

#[test]
fn directory_conflicts_roll_back_tracks_and_artwork_sources() {
    let database = database(&["/old/song.flac"]);
    database
        .connection()
        .unwrap()
        .execute_batch("INSERT INTO music_library_directories (path) VALUES ('/old'), ('/new');")
        .unwrap();
    assert!(database.migrate_library_paths("/old", "/new").is_err());
    assert_eq!(paths(&database), ["/old/song.flac"]);
    assert_eq!(
        database.list_music_library_directories().unwrap()[0].path,
        "/old"
    );
}

#[test]
fn updates_directory_only_locations_and_handles_root_boundaries() {
    let database = database(&["/old/song.flac"]);
    database
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO music_library_directories (path) VALUES ('/empty')",
            [],
        )
        .unwrap();
    assert_eq!(database.migrate_library_paths("/empty", "/new").unwrap(), 1);
    assert_eq!(
        database.list_music_library_directories().unwrap()[0].path,
        "/new"
    );
    assert_eq!(database.migrate_library_paths("/old", "/").unwrap(), 1);
    assert_eq!(paths(&database), ["/song.flac"]);
    assert_eq!(database.migrate_library_paths("/", "C:/Music/").unwrap(), 2);
    assert_eq!(paths(&database), [r"\\?\C:\Music\song.flac"]);
}

#[test]
fn rejects_empty_identical_and_null_prefixes_and_counts_no_matches() {
    let database = database(&["/old/song.flac"]);
    for (old, new) in [
        ("", "/new"),
        ("/old", "  "),
        ("/old", "/old"),
        ("/old", "/new\0"),
    ] {
        assert!(database.migrate_library_paths(old, new).is_err());
    }
    assert_eq!(
        database.migrate_library_paths("/missing", "/new").unwrap(),
        0
    );
    assert_eq!(paths(&database), ["/old/song.flac"]);
}
