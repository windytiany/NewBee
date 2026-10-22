use super::*;
use crate::backup::restore;

#[test]
fn incompatible_schema_is_rejected_before_staging_or_replacing_original_data() {
    let changes = [
        ("column", "title TEXT", "title TEXT, unexpected TEXT"),
        ("type", "duration_ms INTEGER", "duration_ms TEXT"),
        ("delete action", "ON DELETE CASCADE", "ON DELETE RESTRICT"),
        ("check bound", "length(digest) = 32", "length(digest) = 31"),
        (
            "trigger body",
            "WHERE id = OLD.image_id",
            "WHERE id = NEW.image_id",
        ),
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
