use super::*;
use crate::backup::restore;

#[test]
fn read_only_backup_can_be_copied_and_restored_without_changing_source_permissions() {
    let source = Directory::new();
    let target = Directory::new();
    let file = source.0.join("read-only.newbee");
    make_backup(&source.0, &file);
    let original_permissions = fs::metadata(&file).unwrap().permissions();
    let mut read_only = original_permissions.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&file, read_only).unwrap();
    let copied = archive::copy_synced(&file, &target.0.join(restore::PENDING_FILE));
    assert!(fs::metadata(&file).unwrap().permissions().readonly());
    fs::set_permissions(&file, original_permissions).unwrap();
    copied.unwrap();
    assert!(apply_pending_restore(&target.0).unwrap());
    assert!(file.exists());
}

#[cfg(windows)]
#[test]
fn file_replacement_failure_preserves_original_data_and_recovers_on_next_start() {
    use std::os::windows::fs::OpenOptionsExt;
    let source = Directory::new();
    let target = Directory::new();
    let file = source.0.join("backup.newbee");
    make_backup(&source.0, &file);
    let original = fixture(&target.0);
    original.close_test_connection();
    let connection = Connection::open(target.0.join("music-library.sqlite3")).unwrap();
    connection
        .execute("UPDATE tracks SET title = 'original song'", [])
        .unwrap();
    drop(connection);
    fs::write(target.0.join("settings.json"), "original settings").unwrap();
    fs::copy(file, target.0.join(restore::PENDING_FILE)).unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(target.0.join("settings.json"))
        .unwrap();
    assert!(apply_pending_restore(&target.0).is_err());
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original settings"
    );
    drop(locked);
    assert!(!apply_pending_restore(&target.0).unwrap());
    let restored = Database::open(target.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("original song")
    );
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original settings"
    );
    assert!(!target.0.join("playback-session.json").exists());
}

#[test]
fn snapshot_round_trip_includes_database_settings_session_and_interface_without_music() {
    let source = Directory::new();
    let destination = Directory::new();
    let file = source.0.join("backup.newbee");
    make_backup(&source.0, &file);
    let saved = archive::read(&file).unwrap();
    assert_eq!(saved.settings, Settings::default());
    assert_eq!(saved.interface, manifest().interface);
    assert_eq!(saved.session.current_track.unwrap().track_id, Some(1));
    let queue = serde_json::to_value(saved.session.queue).unwrap();
    assert_eq!(queue["currentRowKey"], "row:1");
    assert_eq!(queue["shuffleEnabled"], true);
    assert_eq!(queue["displayedTracks"][0]["trackId"], 1);
    let connection = Connection::open(&file).unwrap();
    let artwork: Vec<u8> = connection
        .query_row("SELECT image FROM artwork_images", [], |row| row.get(0))
        .unwrap();
    assert_eq!(artwork, [1, 2, 3]);
    drop(connection);
    fs::copy(&file, destination.0.join(restore::PENDING_FILE)).unwrap();
    assert!(apply_pending_restore(&destination.0).unwrap());
    let interface: InterfaceState =
        serde_json::from_slice(&fs::read(destination.0.join(restore::INTERFACE_FILE)).unwrap())
            .unwrap();
    assert_eq!(interface, manifest().interface);
    fs::remove_file(destination.0.join(restore::INTERFACE_FILE)).unwrap();
    assert!(!apply_pending_restore(&destination.0).unwrap());
    let restored = Database::open(destination.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert_eq!(restored.list_playlist_tracks(1).unwrap().len(), 1);
    assert_eq!(
        restored.list_music_library_directories().unwrap()[0].path,
        "C:\\Music"
    );
    let connection = Connection::open(destination.0.join("music-library.sqlite3")).unwrap();
    let count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'newbee_backup_manifest'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    let session: serde_json::Value =
        serde_json::from_slice(&fs::read(destination.0.join("playback-session.json")).unwrap())
            .unwrap();
    assert_eq!(session["currentTrack"]["trackId"], 1);
    assert!(session.get("positionMs").is_none());
    assert!(session.get("isPlaying").is_none());
    assert_eq!(session["volume"]["volume"], 30);
    assert!(!destination.0.join("C:\\Music\\missing.flac").exists());
}

#[test]
fn interrupted_partial_restore_rolls_back_original_files_and_missing_files() {
    let directory = Directory::new();
    let rollback = directory.0.join(restore::rollback_directory());
    fs::create_dir(&rollback).unwrap();
    fs::write(rollback.join("settings.json"), "original-settings").unwrap();
    fs::write(rollback.join("music-library.sqlite3"), "original-db").unwrap();
    fs::write(
        rollback.join("prepared.json"),
        "[\"settings.json\",\"music-library.sqlite3\"]",
    )
    .unwrap();
    fs::write(directory.0.join("settings.json"), "imported-settings").unwrap();
    fs::write(directory.0.join("music-library.sqlite3"), "imported-db").unwrap();
    fs::write(
        directory.0.join("playback-session.json"),
        "imported-session",
    )
    .unwrap();
    fs::write(directory.0.join(restore::PENDING_FILE), "pending").unwrap();
    assert!(!apply_pending_restore(&directory.0).unwrap());
    assert_eq!(
        fs::read_to_string(directory.0.join("settings.json")).unwrap(),
        "original-settings"
    );
    assert_eq!(
        fs::read_to_string(directory.0.join("music-library.sqlite3")).unwrap(),
        "original-db"
    );
    assert!(!directory.0.join("playback-session.json").exists());
    assert!(!directory.0.join(restore::PENDING_FILE).exists());
}

#[test]
fn completed_restore_cleanup_does_not_reapply_pending_or_touch_automatic_backups() {
    let directory = Directory::new();
    let rollback = directory.0.join(restore::rollback_directory());
    fs::create_dir(&rollback).unwrap();
    fs::create_dir(directory.0.join("backups")).unwrap();
    fs::write(directory.0.join("backups/before.newbee"), "safety-backup").unwrap();
    fs::write(rollback.join("committed"), "complete").unwrap();
    fs::write(directory.0.join("settings.json"), "restored-settings").unwrap();
    fs::write(directory.0.join(restore::PENDING_FILE), "pending").unwrap();
    assert!(apply_pending_restore(&directory.0).unwrap());
    assert_eq!(
        fs::read_to_string(directory.0.join("settings.json")).unwrap(),
        "restored-settings"
    );
    assert_eq!(
        fs::read_to_string(directory.0.join("backups/before.newbee")).unwrap(),
        "safety-backup"
    );
    assert!(!rollback.exists());
}

#[test]
fn staging_restore_saves_original_data_first_and_keeps_the_backup_after_restore() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    let connection = Connection::open(target.0.join("music-library.sqlite3")).unwrap();
    connection
        .execute("UPDATE tracks SET title = 'original song'", [])
        .unwrap();
    drop(connection);
    let mut current = manifest();
    current.settings.accent_color = "#ff0000".into();
    current
        .interface
        .insert("newbee.active-page".into(), "Playlist".into());
    restore::stage(&target.0, &original, Some(&current), &imported).unwrap();
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("original song")
    );
    let backups = fs::read_dir(target.0.join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    let safety = archive::read(&backups[0]).unwrap();
    assert_eq!(safety.settings.accent_color, "#ff0000");
    assert_eq!(safety.interface["newbee.active-page"], "Playlist");
    let connection = Connection::open(&backups[0]).unwrap();
    let title: String = connection
        .query_row("SELECT title FROM tracks WHERE id = 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "original song");
    drop(connection);
    original.close_test_connection();
    assert!(apply_pending_restore(&target.0).unwrap());
    let restored = Database::open(target.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert!(backups[0].exists());
    archive::read(&backups[0]).unwrap();
}

#[test]
fn automatic_backup_failure_does_not_stage_or_change_the_original() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    fs::write(target.0.join("backups"), "occupied").unwrap();
    assert!(restore::stage(&target.0, &original, Some(&manifest()), &imported).is_err());
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert!(!target.0.join(restore::PENDING_FILE).exists());
    assert!(!target.0.join("settings.json").exists());
    assert!(!target.0.join("playback-session.json").exists());
    assert!(!target.0.join(restore::INTERFACE_FILE).exists());
}

#[test]
fn restore_without_safety_backup_does_not_access_backup_directory() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    let connection = Connection::open(target.0.join("music-library.sqlite3")).unwrap();
    connection
        .execute("UPDATE tracks SET title = 'original song'", [])
        .unwrap();
    drop(connection);
    fs::write(target.0.join("backups"), "occupied").unwrap();
    restore::stage(&target.0, &original, None, &imported).unwrap();
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("original song")
    );
    original.close_test_connection();
    assert!(apply_pending_restore(&target.0).unwrap());
    let restored = Database::open(target.0.join("music-library.sqlite3")).unwrap();
    assert_eq!(
        restored.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert_eq!(
        fs::read_to_string(target.0.join("backups")).unwrap(),
        "occupied"
    );
}

#[test]
fn skipping_safety_backup_still_validates_import_before_changing_original_data() {
    let source = Directory::new();
    let target = Directory::new();
    let imported = source.0.join("import.newbee");
    make_backup(&source.0, &imported);
    let original = fixture(&target.0);
    let connection = Connection::open(&imported).unwrap();
    connection
        .execute_batch("ALTER TABLE tracks ADD COLUMN unexpected TEXT;")
        .unwrap();
    drop(connection);
    fs::write(target.0.join("settings.json"), "original settings").unwrap();
    assert!(restore::stage(&target.0, &original, None, &imported).is_err());
    assert_eq!(
        original.get_track(1).unwrap().unwrap().title(),
        Some("song")
    );
    assert_eq!(
        fs::read_to_string(target.0.join("settings.json")).unwrap(),
        "original settings"
    );
    assert!(!target.0.join("backups").exists());
    assert!(!target.0.join(restore::PENDING_FILE).exists());
}
