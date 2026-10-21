use super::*;
use crate::library::synchronization::{configuration::Mode, migration};
use crate::settings::SettingsState;

#[test]
fn old_backups_restore_and_migrate_without_user_edits() {
    let source = Directory::new();
    let destination = Directory::new();
    let file = source.0.join("previous.newbee");
    make_backup(&source.0, &file);
    let connection = Connection::open(&file).unwrap();
    connection.execute_batch(migration::DIRECTORIES).unwrap();
    connection
        .execute_batch(
            r"INSERT INTO music_library_directories (path) VALUES ('C:\Music'), ('D:\Other');
         PRAGMA user_version = 3;",
        )
        .unwrap();
    let serialized: String = connection
        .query_row("SELECT json FROM newbee_backup_manifest", [], |row| {
            row.get(0)
        })
        .unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&serialized).unwrap();
    let settings = value["settings"].as_object_mut().unwrap();
    let mut folders = settings.remove("synchronizationFolders").unwrap();
    folders[0]["mode"] = "continuous".into();
    folders[0]["enabled"] = false.into();
    settings.insert("monitoringFolders".into(), folders);
    connection
        .execute(
            "UPDATE newbee_backup_manifest SET json = ?1",
            [value.to_string()],
        )
        .unwrap();
    drop(connection);
    let original = fs::read(&file).unwrap();
    let imported = archive::read(&file).unwrap();
    assert!(!imported.settings.synchronization_folders[0].enabled);
    assert_eq!(
        imported.settings.synchronization_folders[0].mode,
        Mode::Continuous
    );
    fs::copy(
        &file,
        destination.0.join(super::super::restore::PENDING_FILE),
    )
    .unwrap();
    assert!(apply_pending_restore(&destination.0).unwrap());
    let path = destination.0.join("settings.json");
    let settings = SettingsState::load(path.clone()).unwrap();
    let database = Database::open(destination.0.join("music-library.sqlite3")).unwrap();
    migration::run(&database, &settings).unwrap();
    let folders = settings.get().unwrap().synchronization_folders;
    assert_eq!(folders.len(), 2);
    assert_eq!(folders[0].path, "C:\\Music");
    assert_eq!(folders[1].path, "D:\\Other");
    assert!(folders
        .iter()
        .all(|folder| folder.enabled && folder.mode == Mode::Manual));
    assert_eq!(database.list_playlist_tracks(1).unwrap().len(), 1);
    let exists: bool = database
        .connection()
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'music_library_directories')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!exists);
    let persisted: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert!(persisted.get("monitoringFolders").is_none());
    assert_eq!(
        persisted["synchronizationFolders"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(fs::read(file).unwrap(), original);
}
