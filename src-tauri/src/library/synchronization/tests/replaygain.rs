use super::support::Scan as Database;
use super::support::{run_scan, run_scan_with_replay_gain};
use crate::fixtures::TestFiles;
use crate::metadata::files::replaygain;
use lofty::{
    config::WriteOptions,
    prelude::TagExt,
    tag::{ItemKey, Tag, TagType},
};
use std::{fs, path::Path};

#[test]
fn opt_in_fills_even_fingerprint_cached_tracks_and_does_not_rewrite_existing_tags() {
    let files = TestFiles::new();
    let path = files.wav("track.wav");
    let path = Path::new(&path);
    let database = Database::open(":memory:").unwrap();
    database.add_folder(&files.0.to_string_lossy()).unwrap();
    run_scan(&database, |_, _| {}).unwrap();
    assert!(!replaygain::read(path).unwrap().complete());
    let initial = fs::read(path).unwrap();
    run_scan(&database, |_, _| {}).unwrap();
    assert_eq!(initial, fs::read(path).unwrap());
    let result = run_scan_with_replay_gain(&database, true, |_, _| {}).unwrap();
    assert_eq!(result.failed, 0);
    assert!(replaygain::read(path).unwrap().complete());
    let analyzed = fs::read(path).unwrap();
    let modified = fs::metadata(path).unwrap().modified().unwrap();
    run_scan_with_replay_gain(&database, true, |_, _| {}).unwrap();
    assert_eq!(analyzed, fs::read(path).unwrap());
    assert_eq!(modified, fs::metadata(path).unwrap().modified().unwrap());
}

#[test]
fn replay_gain_progress_never_rewinds_at_batch_boundaries() {
    let files = TestFiles::new();
    for index in 0..70 {
        files.wav(&format!("{index}.wav"));
    }
    let database = Database::open(":memory:").unwrap();
    database.add_folder(&files.0.to_string_lossy()).unwrap();
    let mut updates = Vec::new();
    let result = run_scan_with_replay_gain(&database, true, |completed, total| {
        updates.push((completed, total));
    })
    .unwrap();
    assert_eq!(result.failed, 0);
    assert_eq!(updates.first(), Some(&(0, 70)));
    assert_eq!(updates.last(), Some(&(70, 70)));
    assert!(
        updates.windows(2).all(|pair| pair[0].0 <= pair[1].0),
        "progress rewound: {updates:?}"
    );
}

#[test]
fn scan_command_uses_the_persisted_opt_in() {
    use crate::{locking::WriteState, settings::Settings};
    use tauri::Manager;
    let files = TestFiles::new();
    let path = files.wav("track.wav");
    let database = Database::open(":memory:").unwrap();
    database.add_folder(&files.0.to_string_lossy()).unwrap();
    let settings = super::support::settings(&files.0);
    settings
        .save(Settings {
            scan_replay_gain: true,
            ..settings.get().unwrap()
        })
        .unwrap();

    let app = tauri::test::mock_builder()
        .manage(super::super::SynchronizationState::default())
        .manage(database.database)
        .manage(settings)
        .manage(WriteState::default())
        .build(tauri::generate_context!())
        .unwrap();
    let result = tauri::async_runtime::block_on(super::super::commands::synchronize_library(
        None,
        app.handle().clone(),
        app.state(),
    ))
    .unwrap();
    assert_eq!(result.failed, 0);
    assert!(replaygain::read(Path::new(&path)).unwrap().complete());
}

#[test]
fn scan_preserves_existing_precise_gain_and_only_adds_the_missing_peak() {
    let files = TestFiles::new();
    let path = files.wav("partial.wav");
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::ReplayGainTrackGain, "-12.345 dB".to_owned());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let database = Database::open(":memory:").unwrap();
    database.add_folder(&files.0.to_string_lossy()).unwrap();
    assert_eq!(
        run_scan_with_replay_gain(&database, true, |_, _| {})
            .unwrap()
            .failed,
        0
    );
    let gain = replaygain::read(Path::new(&path)).unwrap();
    assert_eq!(gain.gain_db, Some(-12.345));
    assert_eq!(gain.peak, Some(0.0));
}

#[test]
fn analysis_failure_is_reported_without_preventing_metadata_import() {
    let files = TestFiles::new();
    let path = files.wav("readonly.wav");
    files.wav("writable.wav");
    let original = fs::read(&path).unwrap();
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    let database = Database::open(":memory:").unwrap();
    database.add_folder(&files.0.to_string_lossy()).unwrap();
    let settings = super::support::settings(&files.0);
    let state = super::super::SynchronizationState::default();
    let result = super::super::reconciliation::run(
        &database,
        &state,
        &settings.get().unwrap().synchronization_folders,
        true,
        |done, total| {
            if done == total {
                fs::set_permissions(&path, permissions.clone()).unwrap();
            }
        },
    )
    .unwrap();
    fs::set_permissions(&path, permissions).unwrap();
    assert_eq!(result.added, 2);
    assert_eq!(result.failed, 1);
    assert_eq!(fs::read(&path).unwrap(), original);
    let data = state.data.lock().unwrap();
    let status = data.statuses.values().next().unwrap();
    assert_eq!(status.phase, "warning");
    assert!(status.error.is_none());
    let issues = status.issues.as_ref().unwrap();
    assert_eq!(issues.failed, 1);
    assert_eq!(issues.replay_gain_failed, 1);
    let serialized = serde_json::to_value(status).unwrap();
    assert_eq!(serialized["issues"]["replayGainFailed"], 1);
    // Writing the other track changes the inventory and triggers a stability
    // pass. A previously failed file must not be analyzed again in that pass.
    assert!(!replaygain::read(Path::new(&path)).unwrap().complete());
}
