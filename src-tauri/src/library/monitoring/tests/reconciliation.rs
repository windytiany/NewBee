use super::super::{
    configuration::{Folder, Mode},
    resolve, MonitoringState,
};
use crate::{
    database::Database,
    fixtures::TestFiles,
    library::{model::ImportResult, scanning},
};
use std::path::PathBuf;

#[test]
fn missing_files_require_confirmation_and_keep_only_suppresses_this_session() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    scanning::run(
        &database,
        &[PathBuf::from(&path)],
        &mut ImportResult::default(),
        |_, _| {},
    )
    .unwrap();
    let folders = vec![Folder {
        path: files.0.to_string_lossy().into(),
        mode: Mode::Continuous,
        enabled: true,
    }];
    let state = MonitoringState::default();
    std::fs::remove_file(&path).unwrap();
    let library = database.library_track_paths().unwrap();
    state.reconcile(&folders[0].path, &library);
    assert!(state.data.lock().unwrap().missing.contains(&path));
    assert_eq!(library.len(), 1);
    assert_eq!(
        resolve(
            &database,
            &state,
            &folders,
            std::slice::from_ref(&path),
            false
        )
        .unwrap(),
        0
    );
    state.reconcile(&folders[0].path, &library);
    assert!(state.data.lock().unwrap().missing.is_empty());
    let restarted = MonitoringState::default();
    restarted.reconcile(&folders[0].path, &library);
    assert!(restarted.data.lock().unwrap().missing.contains(&path));
    assert_eq!(
        resolve(
            &database,
            &restarted,
            &folders,
            std::slice::from_ref(&path),
            true
        )
        .unwrap(),
        1
    );
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn restored_files_and_unavailable_roots_are_not_cleaned() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    scanning::run(
        &database,
        &[PathBuf::from(&path)],
        &mut ImportResult::default(),
        |_, _| {},
    )
    .unwrap();
    let folders = vec![Folder {
        path: files.0.to_string_lossy().into(),
        mode: Mode::Continuous,
        enabled: true,
    }];
    let state = MonitoringState::default();
    std::fs::remove_file(&path).unwrap();
    state.reconcile(&folders[0].path, &database.library_track_paths().unwrap());
    files.wav("song.wav");
    assert_eq!(
        resolve(
            &database,
            &state,
            &folders,
            std::slice::from_ref(&path),
            true
        )
        .unwrap(),
        0
    );
    state.reconcile(&folders[0].path, &database.library_track_paths().unwrap());
    std::fs::remove_file(&path).unwrap();
    state.reconcile(&folders[0].path, &database.library_track_paths().unwrap());
    assert!(state.data.lock().unwrap().missing.contains(&path));
    let offline = files.0.with_extension("offline");
    std::fs::rename(&files.0, &offline).unwrap();
    let result = resolve(
        &database,
        &state,
        &folders,
        std::slice::from_ref(&path),
        true,
    );
    std::fs::rename(offline, &files.0).unwrap();
    assert_eq!(result.unwrap(), 0);
    assert_eq!(database.library_track_paths().unwrap(), vec![path]);
}

#[test]
fn stale_confirmation_cannot_clean_a_disabled_folder() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let database = Database::open(":memory:").unwrap();
    scanning::run(
        &database,
        &[PathBuf::from(&path)],
        &mut ImportResult::default(),
        |_, _| {},
    )
    .unwrap();
    std::fs::remove_file(&path).unwrap();
    let state = MonitoringState::default();
    let root = files.0.to_string_lossy().into_owned();
    state.reconcile(&root, &database.library_track_paths().unwrap());
    let folders = [Folder {
        path: root,
        mode: Mode::Continuous,
        enabled: false,
    }];
    assert_eq!(
        resolve(
            &database,
            &state,
            &folders,
            std::slice::from_ref(&path),
            true
        )
        .unwrap(),
        0
    );
    assert_eq!(database.library_track_paths().unwrap(), vec![path]);
}

#[test]
fn reimport_does_not_remember_manual_exclusions() {
    let files = TestFiles::new();
    let path = PathBuf::from(files.wav("song.wav"));
    let database = Database::open(":memory:").unwrap();
    scanning::run(
        &database,
        std::slice::from_ref(&path),
        &mut ImportResult::default(),
        |_, _| {},
    )
    .unwrap();
    database.remove_track_from_library(1).unwrap();
    scanning::run(&database, &[path], &mut ImportResult::default(), |_, _| {}).unwrap();
    assert_eq!(database.library_track_paths().unwrap().len(), 1);
    assert!(database
        .list_music_library_directories()
        .unwrap()
        .is_empty());
}
