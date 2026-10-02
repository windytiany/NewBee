use super::Database;
use rusqlite::params;
use std::collections::HashSet;

// Scanning stores canonical Windows paths, while users usually enter display paths.
// Normalize lexically: neither the old nor the new location needs to exist yet.
fn normalize_prefix(path: &str) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') {
        return Err("路径不能为空或包含空字符".to_owned());
    }
    Ok(normalize_windows_path(path))
}

fn normalize_windows_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let is_drive_path = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    if is_drive_path || path.starts_with(r"\\") {
        let path = path.replace('/', r"\");
        if path.starts_with(r"\\?\") {
            return path;
        }
        if let Some(unc) = path.strip_prefix(r"\\") {
            return format!(r"\\?\UNC\{unc}");
        }
        return format!(r"\\?\{path}");
    }
    path.to_owned()
}

impl Database {
    pub fn migrate_track_paths(&self, old_path: &str, new_path: &str) -> Result<usize, String> {
        let old_path = normalize_prefix(old_path)?;
        let new_path = normalize_prefix(new_path)?;
        if old_path == new_path {
            return Err("原路径与新路径不能相同".to_owned());
        }

        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始路径迁移：{error}"))?;
        let tracks = {
            let mut statement = transaction
                .prepare("SELECT id, path FROM tracks ORDER BY id")
                .map_err(|error| format!("无法读取曲目路径：{error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| format!("无法读取曲目路径：{error}"))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| format!("无法读取曲目路径：{error}"))?
        };

        let mut final_paths = HashSet::new();
        let mut changes = Vec::new();
        for (id, path) in &tracks {
            let normalized = normalize_windows_path(path);
            if let Some(suffix) = normalized.strip_prefix(&old_path) {
                changes.push((*id, format!("{new_path}{suffix}")));
            } else {
                final_paths.insert(normalized);
            }
        }
        for (_, target) in &changes {
            if !final_paths.insert(target.clone()) {
                return Err(format!("迁移后路径冲突，未修改任何曲目：{target}"));
            }
        }

        // Stage paths inside the transaction so overlapping source/destination
        // prefixes do not cause transient UNIQUE violations. Never change IDs.
        let mut reserved_paths = final_paths;
        reserved_paths.extend(tracks.into_iter().map(|(_, path)| path));
        {
            let mut update = transaction
                .prepare("UPDATE tracks SET path = ?1 WHERE id = ?2")
                .map_err(|error| format!("无法准备路径迁移：{error}"))?;
            for (id, _) in &changes {
                let mut temporary = format!("newbee:path-migration:{id}");
                while !reserved_paths.insert(temporary.clone()) {
                    temporary.push('#');
                }
                update
                    .execute(params![temporary, id])
                    .map_err(|error| format!("路径迁移失败，已回滚：{error}"))?;
            }
            for (id, path) in &changes {
                update
                    .execute(params![path, id])
                    .map_err(|error| format!("路径迁移失败，已回滚：{error}"))?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("无法保存路径迁移：{error}"))?;
        Ok(changes.len())
    }
}

#[cfg(test)]
mod tests {
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
    fn replaces_literal_prefixes_and_preserves_suffixes() {
        let database = database(&[
            "/旧音乐/专辑/曲目.flac",
            "/旧音乐备份/song.mp3",
            "/other/旧音乐/song.mp3",
            "/旧音乐",
        ]);
        assert_eq!(
            database.migrate_track_paths("/旧音乐", "/新音乐").unwrap(),
            3
        );
        assert_eq!(
            paths(&database),
            [
                "/新音乐/专辑/曲目.flac",
                "/新音乐备份/song.mp3",
                "/other/旧音乐/song.mp3",
                "/新音乐",
            ]
        );
    }

    #[test]
    fn treats_sql_wildcards_and_quotes_as_literal_characters() {
        let database = database(&["/a%_'/song.flac", "/abcd/song.flac"]);
        assert_eq!(database.migrate_track_paths("/a%_'", "/new").unwrap(), 1);
        assert_eq!(paths(&database), ["/new/song.flac", "/abcd/song.flac"]);
    }

    #[test]
    fn handles_windows_drive_and_unc_canonical_paths() {
        let database = database(&[r"\\?\C:\音乐\a.flac", r"\\?\UNC\server\share\a.flac"]);
        assert_eq!(
            database
                .migrate_track_paths("C:/音乐/", "D:/Music/")
                .unwrap(),
            1
        );
        assert_eq!(
            database
                .migrate_track_paths(r"\\server\share", r"\\other\music")
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
                .migrate_track_paths(r"C:\Music", r"D:\Music")
                .unwrap(),
            1
        );
        assert_eq!(paths(&database), [r"\\?\D:\Music\a.flac"]);
    }

    #[test]
    fn supports_overlapping_prefixes_without_transient_collisions() {
        let database = database(&["/a/song.flac", "/a/nested/song.flac"]);
        assert_eq!(
            database.migrate_track_paths("/a/", "/a/nested/").unwrap(),
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
        assert_eq!(database.migrate_track_paths("/missing", "/new").unwrap(), 0);
        assert_eq!(database.migrate_track_paths("/old", "/new").unwrap(), 1);
        assert_eq!(paths(&database)[2], "/new/song.flac");
    }

    #[test]
    fn rejects_equivalent_windows_destination_paths() {
        let database = database(&[r"C:\Music\a.flac", r"D:\Music\a.flac"]);
        assert!(database
            .migrate_track_paths(r"C:\Music", r"D:\Music")
            .is_err());
        assert_eq!(paths(&database), [r"C:\Music\a.flac", r"D:\Music\a.flac"]);
    }

    #[test]
    fn matches_case_sensitively_and_preserves_filename_whitespace() {
        let database = database(&["/old/song.flac ", "/Old/song.flac"]);
        assert_eq!(database.migrate_track_paths("/old", "/new").unwrap(), 1);
        assert_eq!(paths(&database), ["/new/song.flac ", "/Old/song.flac"]);
    }

    #[test]
    fn rejects_conflicts_without_partial_changes() {
        let database = database(&["/old/a.flac", "/old/b.flac", "/new/b.flac"]);
        assert!(database
            .migrate_track_paths("/old", "/new")
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
        assert!(database.migrate_track_paths("/old", "/new").is_err());
        assert_eq!(paths(&database), ["/old/a.flac", "/old/b.flac"]);
    }

    #[test]
    fn keeps_metadata_artwork_playlist_items_and_scan_directories() {
        let database = database(&["/old/song.flac"]);
        {
            let connection = database.connection().unwrap();
            connection.execute_batch(
                "INSERT INTO playlists (id, name) VALUES (1, 'playlist');
                 INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 1, 0);
                 INSERT INTO track_artwork (track_id, mime_type, image) VALUES (1, 'image/png', X'0102');
                 INSERT INTO music_library_directories (path) VALUES ('/old');",
            ).unwrap();
        }
        assert_eq!(database.migrate_track_paths("/old", "/new").unwrap(), 1);
        let details = database.get_track(1).unwrap().unwrap();
        assert_eq!(details.path(), "/new/song.flac");
        assert_eq!(details.title.as_deref(), Some("title"));
        assert_eq!(database.list_playlist_tracks(1).unwrap()[0].track_id, 1);
        assert!(matches!(
            database.get_track_artwork(1).unwrap(),
            Some(super::super::TrackArtwork::Available { .. })
        ));
        assert_eq!(
            database.list_music_library_directories().unwrap()[0].path,
            "/old"
        );
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
            assert!(database.migrate_track_paths(old, new).is_err());
        }
        assert_eq!(database.migrate_track_paths("/missing", "/new").unwrap(), 0);
        assert_eq!(paths(&database), ["/old/song.flac"]);
    }
}
