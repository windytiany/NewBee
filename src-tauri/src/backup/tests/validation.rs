use super::*;
use crate::backup::restore;

#[test]
fn rejects_old_database_versions_without_rewriting_backups() {
    let directory = Directory::new();
    let file = directory.0.join("backup.newbee");
    make_backup(&directory.0, &file);
    for version in 1..=3 {
        let connection = Connection::open(&file).unwrap();
        connection
            .pragma_update(None, "user_version", version)
            .unwrap();
        drop(connection);
        let original = fs::read(&file).unwrap();
        assert_eq!(
            archive::read(&file).err().unwrap(),
            "备份数据库与当前版本不兼容"
        );
        assert_eq!(fs::read(&file).unwrap(), original);
    }
}

#[test]
fn rejects_old_settings_without_rewriting_backups() {
    let directory = Directory::new();
    let file = directory.0.join("backup.newbee");
    make_backup(&directory.0, &file);
    let mut value = serde_json::to_value(manifest()).unwrap();
    let settings = value["settings"].as_object_mut().unwrap();
    let folders = settings.remove("synchronizationFolders").unwrap();
    settings.insert("monitoringFolders".into(), folders);
    let connection = Connection::open(&file).unwrap();
    connection
        .execute(
            "UPDATE newbee_backup_manifest SET json = ?1",
            [value.to_string()],
        )
        .unwrap();
    drop(connection);
    let original = fs::read(&file).unwrap();
    assert!(archive::read(&file)
        .err()
        .unwrap()
        .contains("monitoringFolders"));
    assert_eq!(fs::read(&file).unwrap(), original);
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
