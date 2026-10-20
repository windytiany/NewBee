use super::*;
use crate::{library::import::tests::support::TestFiles, settings::Settings};

fn app(files: &TestFiles, mode: Mode) -> tauri::App<tauri::test::MockRuntime> {
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    settings
        .save(Settings {
            monitoring_folders: vec![Folder {
                path: files.0.to_string_lossy().into(),
                mode,
                enabled: true,
            }],
            ..Settings::default()
        })
        .unwrap();
    tauri::test::mock_builder()
        .manage(settings)
        .manage(Database::open(":memory:").unwrap())
        .manage(WriteState::default())
        .manage(MonitoringState::default())
        .build(tauri::generate_context!())
        .unwrap()
}

#[test]
fn disabling_drops_work_and_reenabling_schedules_a_fresh_scan_without_removing_tracks() {
    let files = TestFiles::new();
    files.wav("first.wav");
    let app = app(&files, Mode::Continuous);
    let settings = app.state::<SettingsState>();
    let mut configuration = settings.get().unwrap();
    let mut work = BTreeMap::new();
    configure(&mut work, &configuration.monitoring_folders);
    let path = configuration.monitoring_folders[0].path.clone();
    let entry = work.get_mut(&path).unwrap();
    entry.process(app.handle()).unwrap();
    entry.process(app.handle()).unwrap();
    let (sender, _receiver) = mpsc::sync_channel(1);
    entry.watch(&sender);
    assert!(entry.watcher.is_some());
    configuration.monitoring_folders[0].enabled = false;
    settings.save(configuration.clone()).unwrap();
    configure(&mut work, &configuration.monitoring_folders);
    assert!(work.is_empty());
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        1
    );
    files.wav("second.wav");
    configure(&mut work, &configuration.monitoring_folders);
    assert!(work.is_empty());
    configuration.monitoring_folders[0].enabled = true;
    settings.save(configuration.clone()).unwrap();
    configure(&mut work, &configuration.monitoring_folders);
    let entry = work.get_mut(&path).unwrap();
    assert!(entry.candidate.is_none());
    assert!(entry.due.is_some());
    entry.process(app.handle()).unwrap();
    entry.process(app.handle()).unwrap();
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        2
    );
}

#[test]
fn replay_gain_monitoring_publishes_active_progress_before_writing_and_clears_it() {
    use tauri::Listener;
    let files = TestFiles::new();
    files.wav("song.wav");
    let app = app(&files, Mode::Startup);
    let settings = app.state::<SettingsState>();
    let mut configuration = settings.get().unwrap();
    configuration.scan_replay_gain = true;
    settings.save(configuration.clone()).unwrap();
    let snapshots = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let received = snapshots.clone();
    let handle = app.handle().clone();
    app.listen(super::super::EVENT, move |_| {
        let snapshot =
            super::super::get_library_monitoring(handle.state(), handle.state()).unwrap();
        received
            .lock()
            .unwrap()
            .push(serde_json::to_value(snapshot).unwrap());
    });
    let mut work = Work::new(configuration.monitoring_folders.remove(0));
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    let snapshots = snapshots.lock().unwrap();
    assert!(
        snapshots.iter().any(|snapshot| {
            snapshot["progress"]["completed"] == 0 && snapshot["progress"]["total"] == 1
        }),
        "background ReplayGain writes were invisible: {snapshots:?}"
    );
    let snapshot = super::super::get_library_monitoring(app.state(), app.state()).unwrap();
    assert!(serde_json::to_value(snapshot).unwrap()["progress"].is_null());
    assert!(app.state::<WriteState>().acquire().is_ok());
}

#[test]
fn startup_imports_once_without_registering_a_watcher() {
    let files = TestFiles::new();
    files.wav("song.wav");
    let app = app(&files, Mode::Startup);
    let folder = app
        .state::<SettingsState>()
        .get()
        .unwrap()
        .monitoring_folders
        .remove(0);
    let mut work = Work::new(folder);
    let (sender, _) = mpsc::sync_channel(1);
    work.watch(&sender);
    assert!(work.watcher.is_none());
    work.process(app.handle()).unwrap();
    assert!(app
        .state::<Database>()
        .library_track_paths()
        .unwrap()
        .is_empty());
    work.process(app.handle()).unwrap();
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        1
    );
    assert!(work.due.is_none());
    assert!(app
        .state::<Database>()
        .list_music_library_directories()
        .unwrap()
        .is_empty());
}

#[test]
fn continuous_detects_events_and_renames_as_missing_plus_new() {
    let files = TestFiles::new();
    let old = files.wav("old.wav");
    let app = app(&files, Mode::Continuous);
    let folder = app
        .state::<SettingsState>()
        .get()
        .unwrap()
        .monitoring_folders
        .remove(0);
    let mut work = Work::new(folder);
    let (sender, receiver) = mpsc::sync_channel(1);
    work.watch(&sender);
    assert!(work.watch_error.is_none(), "{:?}", work.watch_error);
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    let new = files.0.join("new.wav");
    std::fs::rename(&old, &new).unwrap();
    receiver.recv_timeout(Duration::from_secs(5)).unwrap();
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    let database = app.state::<Database>();
    assert_eq!(database.library_track_paths().unwrap().len(), 2);
    assert!(app
        .state::<MonitoringState>()
        .data
        .lock()
        .unwrap()
        .missing
        .contains(&old));
    assert_eq!(
        super::super::resolve(
            &database,
            &app.state::<MonitoringState>(),
            &app.state::<SettingsState>()
                .get()
                .unwrap()
                .monitoring_folders,
            &[old],
            true
        )
        .unwrap(),
        1
    );
    assert_eq!(
        database.library_track_paths().unwrap(),
        vec![new.to_string_lossy().into_owned()]
    );
}

#[test]
fn retries_are_bounded_and_new_changes_reset_the_budget() {
    let files = TestFiles::new();
    files.write("broken.wav", b"not audio");
    let app = app(&files, Mode::Startup);
    let folder = app
        .state::<SettingsState>()
        .get()
        .unwrap()
        .monitoring_folders
        .remove(0);
    let mut work = Work::new(folder);
    work.process(app.handle()).unwrap();
    for _ in 0..MAX_ATTEMPTS {
        work.process(app.handle()).unwrap();
    }
    assert_eq!(work.attempts, MAX_ATTEMPTS);
    assert!(work.due.is_none());
    files.wav("broken.wav");
    work.process(app.handle()).unwrap();
    assert_eq!(work.attempts, 0);
    work.process(app.handle()).unwrap();
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        1
    );
    assert_eq!(work.attempts, 0);
}

#[test]
fn unavailable_root_cannot_report_missing_and_recovers() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let app = app(&files, Mode::Continuous);
    let folder = app
        .state::<SettingsState>()
        .get()
        .unwrap()
        .monitoring_folders
        .remove(0);
    let mut work = Work::new(folder);
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    std::fs::remove_file(&path).unwrap();
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    assert!(!app
        .state::<MonitoringState>()
        .data
        .lock()
        .unwrap()
        .missing
        .is_empty());
    let offline = files.0.with_extension("offline");
    std::fs::rename(&files.0, &offline).unwrap();
    let outcome = work.process(app.handle());
    std::fs::rename(offline, &files.0).unwrap();
    outcome.unwrap();
    assert!(app
        .state::<MonitoringState>()
        .data
        .lock()
        .unwrap()
        .missing
        .is_empty());
    assert!(work.due.is_some());
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    assert!(app
        .state::<MonitoringState>()
        .data
        .lock()
        .unwrap()
        .missing
        .contains(&path));
}
