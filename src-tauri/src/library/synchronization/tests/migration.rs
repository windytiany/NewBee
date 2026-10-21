use super::super::{
    configuration::{Folder, Mode},
    migration,
};
use crate::{database::Database, fixtures::TestFiles, settings::SettingsState};
use rusqlite::Connection;

fn database(files: &TestFiles, paths: &[&str]) -> Database {
    let path = files.0.join("library.sqlite3");
    drop(Database::open(&path).unwrap());
    let connection = Connection::open(&path).unwrap();
    connection.execute_batch(migration::DIRECTORIES).unwrap();
    for path in paths {
        connection
            .execute(
                "INSERT INTO music_library_directories (path) VALUES (?1)",
                [path],
            )
            .unwrap();
    }
    connection.pragma_update(None, "user_version", 3).unwrap();
    drop(connection);
    Database::open(path).unwrap()
}

fn has_table(database: &Database) -> bool {
    database
        .connection()
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'music_library_directories')",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn startup_automatically_merges_sources_retires_the_table_and_survives_restart() {
    let files = TestFiles::new();
    let path = files.0.join("settings.json");
    std::fs::write(
        &path,
        br#"{"locale":"en","monitoringFolders":[
        {"path":"/offline/live","mode":"continuous","enabled":true},
        {"path":"/offline/disabled","mode":"startup","enabled":false}
    ]}"#,
    )
    .unwrap();
    let database = database(
        &files,
        &["/offline/live", "/offline/disabled", "/offline/manual"],
    );
    let settings = SettingsState::load(path.clone()).unwrap();
    migration::run(&database, &settings).unwrap();
    let folders = settings.get().unwrap().synchronization_folders;
    assert_eq!(
        folders,
        vec![
            Folder {
                path: "/offline/live".into(),
                mode: Mode::Continuous,
                enabled: true
            },
            Folder {
                path: "/offline/disabled".into(),
                mode: Mode::Manual,
                enabled: true
            },
            Folder {
                path: "/offline/manual".into(),
                mode: Mode::Manual,
                enabled: true
            },
        ]
    );
    assert!(!has_table(&database));
    assert_eq!(
        database
            .connection()
            .unwrap()
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        4
    );
    let persisted = std::fs::read(&path).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&persisted).unwrap();
    assert!(json.get("monitoringFolders").is_none());
    assert_eq!(json["locale"], "en");
    drop(database);
    let database = Database::open(files.0.join("library.sqlite3")).unwrap();
    let settings = SettingsState::load(path.clone()).unwrap();
    migration::run(&database, &settings).unwrap();
    assert!(!has_table(&database));
    assert_eq!(settings.get().unwrap().synchronization_folders, folders);
    assert_eq!(std::fs::read(path).unwrap(), persisted);
}

#[test]
fn failed_configuration_write_keeps_the_table_and_retries_automatically() {
    let files = TestFiles::new();
    let database = database(&files, &["/offline/music"]);
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    let before = settings.get().unwrap();
    let temporary = files.0.join("settings.json.tmp");
    std::fs::create_dir(&temporary).unwrap();
    assert!(migration::run(&database, &settings).is_err());
    assert!(has_table(&database));
    assert_eq!(settings.get().unwrap(), before);
    std::fs::remove_dir(temporary).unwrap();
    migration::run(&database, &settings).unwrap();
    assert!(!has_table(&database));
    assert_eq!(
        settings.get().unwrap().synchronization_folders[0].path,
        "/offline/music"
    );
}

#[test]
fn retries_after_configuration_was_saved_but_table_was_not_retired() {
    let files = TestFiles::new();
    let database = database(&files, &["/offline/music"]);
    std::fs::write(
        files.0.join("settings.json"),
        br#"{"synchronizationFolders":[
        {"path":"/offline/music","mode":"manual","enabled":true}
    ]}"#,
    )
    .unwrap();
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    migration::run(&database, &settings).unwrap();
    assert!(!has_table(&database));
    assert_eq!(settings.get().unwrap().synchronization_folders.len(), 1);
}

#[test]
fn empty_table_is_retired_and_new_databases_never_create_it() {
    let files = TestFiles::new();
    let database = database(&files, &[]);
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    migration::run(&database, &settings).unwrap();
    assert!(!has_table(&database));
    assert!(!has_table(&Database::open(":memory:").unwrap()));
}

#[test]
fn settings_only_users_are_migrated_without_a_database_directory() {
    let files = TestFiles::new();
    let path = files.0.join("settings.json");
    let original =
        br#"{"monitoringFolders":[{"path":"/offline/music","mode":"startup","enabled":false}]}"#;
    assert!(serde_json::from_slice::<crate::settings::Settings>(original).is_err());
    std::fs::write(&path, original).unwrap();
    std::fs::create_dir(files.0.join("settings.json.tmp")).unwrap();
    assert!(SettingsState::load(path.clone()).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    std::fs::remove_dir(files.0.join("settings.json.tmp")).unwrap();
    let settings = SettingsState::load(path.clone()).unwrap();
    let folders = settings.get().unwrap().synchronization_folders;
    assert_eq!(folders[0].mode, Mode::Startup);
    assert!(!folders[0].enabled);
    let migrated: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert!(migrated.get("monitoringFolders").is_none());
    assert_eq!(
        migrated["synchronizationFolders"].as_array().unwrap().len(),
        1
    );
}
