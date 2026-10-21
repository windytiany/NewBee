use super::*;
use crate::{
    fixtures::TestFiles,
    library::synchronization::configuration::{Folder, Mode},
    settings::Settings,
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
fn remaps_external_tracks_and_offline_synchronization_folders() {
    let files = TestFiles::new();
    let settings = settings(&files, &["/old/music"]);
    let database = Database::open(":memory:").unwrap();
    database.connection().unwrap().execute_batch("INSERT INTO tracks (path, title, in_library) VALUES ('/old/music/song.wav', 'song', 0);").unwrap();
    assert_eq!(remap(&database, &settings, "/old", "/offline"), Ok(2));
    assert_eq!(
        database.get_track(1).unwrap().unwrap().path(),
        "/offline/music/song.wav"
    );
    let loaded = SettingsState::load(files.0.join("settings.json"))
        .unwrap()
        .get()
        .unwrap();
    assert_eq!(loaded.synchronization_folders[0].path, "/offline/music");
    assert_eq!(loaded.synchronization_folders[0].mode, Mode::Manual);
}

#[test]
fn remaps_folder_only_locations_without_track_records() {
    let files = TestFiles::new();
    let settings = settings(&files, &["/old/empty"]);
    let database = Database::open(":memory:").unwrap();
    assert_eq!(remap(&database, &settings, "/old", "/new"), Ok(1));
    assert_eq!(
        SettingsState::load(files.0.join("settings.json"))
            .unwrap()
            .get()
            .unwrap()
            .synchronization_folders[0]
            .path,
        "/new/empty"
    );
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

#[test]
fn synchronization_continues_after_remapping_and_confirms_missing_files() {
    use crate::library::synchronization::{self, commands};

    let files = TestFiles::new();
    std::fs::create_dir(files.0.join("old")).unwrap();
    files.wav("old/kept.wav");
    let missing = files.wav("old/missing.wav");
    let old = files.0.join("old").to_string_lossy().into_owned();
    let new = files.0.join("new").to_string_lossy().into_owned();
    let app = tauri::test::mock_builder()
        .manage(settings(&files, &[&old]))
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .manage(SynchronizationState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let scan = || {
        serde_json::to_value(
            tauri::async_runtime::block_on(commands::synchronize_library(
                None,
                app.handle().clone(),
                app.state(),
            ))
            .unwrap(),
        )
        .unwrap()
    };
    let snapshot = || {
        serde_json::to_value(
            synchronization::get_library_synchronization(app.state(), app.state()).unwrap(),
        )
        .unwrap()
    };
    assert_eq!(scan()["added"], 2);
    std::fs::remove_file(&missing).unwrap();
    assert_eq!(scan()["failed"], 0);
    assert_eq!(snapshot()["missing"][0], missing);
    std::fs::rename(&old, &new).unwrap();

    let guard = app.state::<WriteState>().acquire().unwrap();
    assert!(tauri::async_runtime::block_on(remap_paths(
        old.clone(),
        new.clone(),
        app.handle().clone(),
    ))
    .is_err());
    assert_eq!(
        app.state::<SettingsState>()
            .get()
            .unwrap()
            .synchronization_folders[0]
            .path,
        old
    );
    drop(guard);
    assert_eq!(
        tauri::async_runtime::block_on(remap_paths(old, new.clone(), app.handle().clone()))
            .unwrap(),
        3
    );
    assert_eq!(snapshot()["missing"], serde_json::json!([]));
    assert_eq!(snapshot()["statuses"], serde_json::json!([]));
    let result = scan();
    assert_eq!(result["added"], 0);
    assert_eq!(result["failed"], 0);
    let missing = files
        .0
        .join("new/missing.wav")
        .to_string_lossy()
        .into_owned();
    assert_eq!(snapshot()["missing"][0], missing);
    assert_eq!(
        tauri::async_runtime::block_on(synchronization::resolve_library_synchronization(
            app.handle().clone(),
            vec![missing],
            true,
        ))
        .unwrap(),
        1
    );
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap(),
        vec![files.0.join("new/kept.wav").to_string_lossy().into_owned()]
    );
}

#[test]
fn untouched_preferences_are_preserved() {
    let files = TestFiles::new();
    let old = files.0.to_string_lossy().into_owned();
    let new = files
        .0
        .with_extension("remapped")
        .to_string_lossy()
        .into_owned();
    let settings = settings(&files, &[&old]);
    let mut before = settings.get().unwrap();
    before.locale = crate::settings::Locale::En;
    settings.save(Settings { ..before.clone() }).unwrap();
    let database = Database::open(":memory:").unwrap();
    remap(&database, &settings, &old, &new).unwrap();
    before.synchronization_folders[0].path = new;
    assert_eq!(settings.get().unwrap(), before);
}
