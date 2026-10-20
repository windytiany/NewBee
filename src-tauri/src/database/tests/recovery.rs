use crate::database::{tests::support::insert_track, Database};
use crate::tracks::model::{References, TrackRegistrationResult};
use std::collections::HashSet;

fn track(database: &Database, id: i64, artwork: Option<&[u8]>) {
    insert_track(database, id, None, None, id, artwork);
    database
        .connection()
        .unwrap()
        .execute("UPDATE tracks SET in_library = 0 WHERE id = ?1", [id])
        .unwrap();
}

fn run(database: &Database, references: References) {
    let _ = database.collect_orphan_tracks(references);
}

fn count(database: &Database, table: &str) -> i64 {
    database
        .connection()
        .unwrap()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn orphan_registration_and_attached_data_are_deleted_but_shared_artwork_and_other_statistics_survive(
) {
    let database = Database::open(":memory:").unwrap();
    track(&database, 1, Some(b"shared"));
    track(&database, 2, Some(b"shared"));
    assert!(!database.record_track_play(1).unwrap());
    database
        .connection()
        .unwrap()
        .execute("UPDATE tracks SET in_library = 1 WHERE id = 2", [])
        .unwrap();
    database.record_track_play(2).unwrap();
    database.set_tracks_skipped(&[1, 2], true).unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "INSERT INTO track_lyrics (track_id, text) VALUES (1, 'orphan'), (2, 'retained');
         INSERT INTO track_editing (track_id, snapshot) VALUES (1, '{}'), (2, '{}');
         INSERT INTO track_artwork_pending (track_id) VALUES (1), (2);",
        )
        .unwrap();
    let content: String = database
        .connection()
        .unwrap()
        .query_row("SELECT content_id FROM artwork_images", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(2, Some(128), |bytes, _| Ok(bytes))
            .unwrap(),
        b"shared"
    );
    run(
        &database,
        References {
            ids: vec![2],
            paths: vec![],
        },
    );
    assert!(database.get_track(1).unwrap().is_none());
    assert!(database.get_track(2).unwrap().is_some());
    for table in [
        "track_play_statistics",
        "track_lyrics",
        "track_editing",
        "track_artwork_pending",
        "track_artwork",
        "track_artwork_sources",
        "artwork_images",
    ] {
        assert_eq!(count(&database, table), 1, "{table}");
    }
    assert_eq!(database.list_skipped_track_ids().unwrap(), [2]);
    assert_eq!(
        *database.skipped_tracks().read().unwrap(),
        HashSet::from([2])
    );
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row(
                "SELECT play_count FROM track_play_statistics WHERE track_id = 2",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );
    assert_eq!(
        database
            .artwork_content_bytes(&content, Some(128), |_, _| panic!(
                "shared thumbnail was removed"
            ))
            .unwrap(),
        b"shared"
    );
}

#[test]
fn library_inbox_and_playlist_each_independently_protect_registration() {
    for membership in [
        "UPDATE tracks SET in_library = 1 WHERE id = 1",
        "INSERT INTO inbox (track_id, added_at) VALUES (1, 0)",
        "INSERT INTO playlists (id, name) VALUES (1, 'list'); INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 1, 0)",
    ] {
        let database = Database::open(":memory:").unwrap();
        track(&database, 1, None);
        track(&database, 2, None);
        database.connection().unwrap().execute_batch(membership).unwrap();
        run(&database, References::default());
        assert!(database.get_track(1).unwrap().is_some(), "{membership}");
        assert!(database.get_track(2).unwrap().is_none(), "{membership}");
    }
}

#[test]
fn removing_only_some_references_keeps_registration_until_the_next_startup_without_any() {
    let database = Database::open(":memory:").unwrap();
    track(&database, 1, None);
    database
        .connection()
        .unwrap()
        .execute_batch(
            "UPDATE tracks SET in_library = 1 WHERE id = 1;
         INSERT INTO inbox (track_id, added_at) VALUES (1, 0);
         INSERT INTO playlists (id, name) VALUES (1, 'list');
         INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (1, 1, 0), (1, 1, 1);
         UPDATE tracks SET in_library = 0 WHERE id = 1;
         DELETE FROM inbox; DELETE FROM playlist_items WHERE position = 0;",
        )
        .unwrap();
    run(&database, References::default());
    assert!(database.get_track(1).unwrap().is_some());
    database
        .connection()
        .unwrap()
        .execute("DELETE FROM playlist_items", [])
        .unwrap();
    // Runtime removal itself does not collect registration.
    assert!(database.get_track(1).unwrap().is_some());
    run(&database, References::default());
    assert!(database.get_track(1).unwrap().is_none());
}

#[test]
fn restored_ids_and_registered_current_path_are_protected_without_file_access() {
    let database = Database::open(":memory:").unwrap();
    for id in 1..=5 {
        track(&database, id, None);
    }
    let current_path = database.get_track(4).unwrap().unwrap().path;
    run(
        &database,
        References {
            ids: vec![1, 2, 3],
            paths: vec![current_path],
        },
    );
    assert_eq!(count(&database, "tracks"), 4);
    for id in 1..=4 {
        assert!(database.get_track(id).unwrap().is_some());
    }
    assert!(database.get_track(5).unwrap().is_none());
}

#[test]
fn unresolved_playback_path_skips_collection() {
    let database = Database::open(":memory:").unwrap();
    track(&database, 1, None);
    assert!(database
        .collect_orphan_tracks(References {
            ids: vec![],
            paths: vec!["unresolved.flac".into()],
        })
        .is_err());
    assert!(database.get_track(1).unwrap().is_some());
}

#[test]
fn delete_trigger_failure_rolls_back_preceding_tracks_and_all_attached_data() {
    let database = Database::open(":memory:").unwrap();
    for id in 1..=2 {
        track(&database, id, Some(&[id as u8]));
        assert!(!database.record_track_play(id).unwrap());
    }
    database.set_tracks_skipped(&[1, 2], true).unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "INSERT INTO track_lyrics (track_id, text) VALUES (1, 'one'), (2, 'two');
         INSERT INTO track_editing (track_id, snapshot) VALUES (1, '{}'), (2, '{}');
         INSERT INTO track_artwork_pending (track_id) VALUES (1), (2);
         CREATE TRIGGER fail_cleanup BEFORE DELETE ON tracks WHEN OLD.id = 2
         BEGIN SELECT RAISE(ABORT, 'cleanup rejected'); END;",
        )
        .unwrap();
    run(&database, References::default());
    for table in [
        "tracks",
        "track_lyrics",
        "track_editing",
        "track_artwork_pending",
        "skipped_tracks",
        "track_artwork",
        "track_artwork_sources",
        "artwork_images",
    ] {
        assert_eq!(count(&database, table), 2, "{table}");
    }
    assert_eq!(
        *database.skipped_tracks().read().unwrap(),
        HashSet::from([1, 2])
    );
    assert!(matches!(
        database.get_track_artwork(1).unwrap().unwrap(),
        crate::artwork::track::TrackArtwork::Available { mime_type, data }
            if mime_type == "image/png" && data == [1]
    ));
}

fn register(database: &Database, path: &str) -> i64 {
    match crate::tracks::register(database, &[path.into()])
        .unwrap()
        .remove(0)
    {
        TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("fixture registration failed"),
    }
}

#[test]
fn pending_orphan_is_removed_without_touching_original_and_late_confirmation_cannot_recreate_it() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("song.flac");
    let original = include_bytes!("../../../fixtures/silence.flac");
    std::fs::write(&path, original).unwrap();
    let path = path.canonicalize().unwrap().to_string_lossy().into_owned();
    let database = Database::open(":memory:").unwrap();
    let id = register(&database, &path);
    database.record_track_play(id).unwrap();
    let (_, revision) = database.pending_track(id).unwrap().unwrap();
    let late = || crate::database::tracks::confirmation::Confirmation {
        id,
        revision,
        path: path.clone(),
        snapshot: crate::tracks::inspect(&database, std::path::Path::new(&path)),
    };
    let confirmation = late();
    let second_confirmation = late();
    crate::metadata::files::access::take(directory.path());
    run(&database, References::default());
    assert!(crate::metadata::files::access::take(directory.path()).is_empty());
    assert!(database.pending_track_ids().unwrap().is_empty());
    assert!(database
        .confirm_tracks(vec![confirmation])
        .unwrap()
        .is_empty());
    assert!(database.get_track(id).unwrap().is_none());
    assert_eq!(count(&database, "track_play_statistics"), 0);
    assert_eq!(std::fs::read(&path).unwrap(), original);
    let next_id = register(&database, &path);
    assert!(next_id > id);
    assert!(database
        .confirm_tracks(vec![second_confirmation])
        .unwrap()
        .is_empty());
    assert!(database
        .get_track(next_id)
        .unwrap()
        .unwrap()
        .duration_ms
        .is_none());
    assert_eq!(count(&database, "track_play_statistics"), 0);
    assert!(!database.record_track_play(next_id).unwrap());
    assert_eq!(count(&database, "track_play_statistics"), 0);
}
