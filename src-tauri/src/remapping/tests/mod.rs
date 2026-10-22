use super::*;
use crate::{
    fixtures::TestFiles,
    library::synchronization::configuration::{Folder, Mode},
};

fn settings(files: &TestFiles, paths: &[&str]) -> SettingsState {
    let state = SettingsState::load(files.0.join("settings.json")).unwrap();
    state
        .update_folders(|folders| {
            *folders = paths
                .iter()
                .map(|path| Folder {
                    path: (*path).into(),
                    mode: Mode::Manual,
                    enabled: true,
                })
                .collect();
            Ok(())
        })
        .unwrap();
    state
}

#[test]
fn folder_conflicts_roll_back_database_and_configuration() {
    let files = TestFiles::new();
    let settings = settings(&files, &["/old", "/new"]);
    let before = settings.get().unwrap();
    let database = Database::open(":memory:").unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch("INSERT INTO tracks (path) VALUES ('/old/song.wav');")
        .unwrap();
    assert!(remap(&database, &settings, "/old", "/new").is_err());
    assert_eq!(settings.get().unwrap(), before);
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        "/old/song.wav"
    );
}

#[test]
fn settings_write_failure_rolls_back_database() {
    let files = TestFiles::new();
    let settings = settings(&files, &["/old"]);
    let before = settings.get().unwrap();
    let persisted = std::fs::read(files.0.join("settings.json")).unwrap();
    std::fs::create_dir(files.0.join("settings.json.tmp")).unwrap();
    let database = Database::open(":memory:").unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch("INSERT INTO tracks (path) VALUES ('/old/song.wav');")
        .unwrap();
    assert!(remap(&database, &settings, "/old", "/new").is_err());
    assert_eq!(settings.get().unwrap(), before);
    assert_eq!(
        std::fs::read(files.0.join("settings.json")).unwrap(),
        persisted
    );
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        "/old/song.wav"
    );
}
