use super::*;
use crate::{fixtures::TestFiles, settings::Settings};

fn app(files: &TestFiles, mode: Mode) -> tauri::App<tauri::test::MockRuntime> {
    let settings = SettingsState::load(files.0.join("settings.json")).unwrap();
    settings
        .save(Settings {
            synchronization_folders: vec![Folder {
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
        .manage(SynchronizationState::default())
        .build(tauri::generate_context!())
        .unwrap()
}

#[test]
fn manual_mode_only_runs_on_request_and_uses_the_same_missing_file_queue() {
    let files = TestFiles::new();
    let path = files.wav("song.wav");
    let app = app(&files, Mode::Manual);
    let mut work = BTreeMap::new();
    let folders = app
        .state::<SettingsState>()
        .get()
        .unwrap()
        .synchronization_folders;
    configure(&mut work, &folders);
    let entry = work.get_mut(&folders[0].path).unwrap();
    assert!(entry.due.is_none());
    let (sender, _) = mpsc::sync_channel(1);
    entry.watch(&sender);
    assert!(entry.watcher.is_none());
    assert!(app
        .state::<Database>()
        .library_track_paths()
        .unwrap()
        .is_empty());
    let scan = || {
        tauri::async_runtime::block_on(super::super::commands::synchronize_library(
            None,
            app.handle().clone(),
            app.state(),
        ))
        .unwrap()
    };
    assert_eq!(scan().added, 1);
    std::fs::remove_file(&path).unwrap();
    assert_eq!(scan().failed, 0);
    assert!(app
        .state::<SynchronizationState>()
        .data
        .lock()
        .unwrap()
        .missing
        .contains(&path));
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        1
    );
    super::super::resolve(
        &app.state::<Database>(),
        &app.state::<SynchronizationState>(),
        &folders,
        std::slice::from_ref(&path),
        false,
    )
    .unwrap();
    scan();
    assert!(!app
        .state::<SynchronizationState>()
        .data
        .lock()
        .unwrap()
        .missing
        .contains(&path));
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        1
    );
}

#[test]
fn disabling_drops_work_and_reenabling_schedules_a_fresh_scan_without_removing_tracks() {
    let files = TestFiles::new();
    files.wav("first.wav");
    let app = app(&files, Mode::Continuous);
    let settings = app.state::<SettingsState>();
    let mut configuration = settings.get().unwrap();
    let mut work = BTreeMap::new();
    configure(&mut work, &configuration.synchronization_folders);
    let path = configuration.synchronization_folders[0].path.clone();
    let entry = work.get_mut(&path).unwrap();
    entry.process(app.handle()).unwrap();
    entry.process(app.handle()).unwrap();
    let (sender, _receiver) = mpsc::sync_channel(1);
    entry.watch(&sender);
    assert!(entry.watcher.is_some());
    configuration.synchronization_folders[0].enabled = false;
    settings.save(configuration.clone()).unwrap();
    configure(&mut work, &configuration.synchronization_folders);
    assert!(work.is_empty());
    assert_eq!(
        app.state::<Database>().library_track_paths().unwrap().len(),
        1
    );
    files.wav("second.wav");
    configure(&mut work, &configuration.synchronization_folders);
    assert!(work.is_empty());
    configuration.synchronization_folders[0].enabled = true;
    settings.save(configuration.clone()).unwrap();
    configure(&mut work, &configuration.synchronization_folders);
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
            super::super::get_library_synchronization(handle.state(), handle.state()).unwrap();
        received
            .lock()
            .unwrap()
            .push(serde_json::to_value(snapshot).unwrap());
    });
    let mut work = Work::new(configuration.synchronization_folders.remove(0));
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    let snapshots = snapshots.lock().unwrap();
    assert!(
        snapshots.iter().any(|snapshot| {
            snapshot["progress"]["completed"] == 0 && snapshot["progress"]["total"] == 1
        }),
        "background ReplayGain writes were invisible: {snapshots:?}"
    );
    let snapshot = super::super::get_library_synchronization(app.state(), app.state()).unwrap();
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
        .synchronization_folders
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
    assert_eq!(
        app.state::<SettingsState>()
            .get()
            .unwrap()
            .synchronization_folders
            .len(),
        1
    );
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
        .synchronization_folders
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
        .state::<SynchronizationState>()
        .data
        .lock()
        .unwrap()
        .missing
        .contains(&old));
    assert_eq!(
        super::super::resolve(
            &database,
            &app.state::<SynchronizationState>(),
            &app.state::<SettingsState>()
                .get()
                .unwrap()
                .synchronization_folders,
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
fn failed_scans_are_not_retried_until_files_change() {
    use std::sync::{atomic::AtomicUsize, Arc};
    use tauri::Listener;

    for mode in [Mode::Startup, Mode::Continuous] {
        let files = TestFiles::new();
        files.write("broken.wav", b"not audio");
        let app = app(&files, mode);
        let folder = app
            .state::<SettingsState>()
            .get()
            .unwrap()
            .synchronization_folders
            .remove(0);
        let mut work = Work::new(folder);
        work.process(app.handle()).unwrap();
        work.process(app.handle()).unwrap();
        if mode == Mode::Startup {
            assert!(work.due.is_none());
        } else {
            assert!(work.due.unwrap() > Instant::now() + SETTLE);
        }
        let events = Arc::new(AtomicUsize::new(0));
        let received = events.clone();
        app.listen(super::super::EVENT, move |_| {
            received.fetch_add(1, Ordering::Relaxed);
        });
        // Periodic or watcher wakeups must not rerun the failed inventory.
        for _ in 0..3 {
            work.process(app.handle()).unwrap();
        }
        assert_eq!(events.load(Ordering::Relaxed), 0);
        files.wav("broken.wav");
        work.process(app.handle()).unwrap();
        work.process(app.handle()).unwrap();
        assert_eq!(
            app.state::<Database>().library_track_paths().unwrap().len(),
            1
        );
        assert!(!work.failed);
    }
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
        .synchronization_folders
        .remove(0);
    let mut work = Work::new(folder);
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    std::fs::remove_file(&path).unwrap();
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    assert!(!app
        .state::<SynchronizationState>()
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
        .state::<SynchronizationState>()
        .data
        .lock()
        .unwrap()
        .missing
        .is_empty());
    assert!(work.due.is_some());
    work.process(app.handle()).unwrap();
    work.process(app.handle()).unwrap();
    assert!(app
        .state::<SynchronizationState>()
        .data
        .lock()
        .unwrap()
        .missing
        .contains(&path));
}
