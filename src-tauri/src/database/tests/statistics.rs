use super::*;

fn database() -> Database {
    let database = Database::open(":memory:").unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "INSERT INTO tracks (path, title, artist, album) VALUES
         ('a.mp3', 'Alpha', 'Artist A', 'Album A'),
         ('b.mp3', 'Beta', 'Artist B', 'Album B'),
         ('c.mp3', 'Gamma', NULL, NULL),
         ('d.mp3', 'Delta', NULL, NULL);
         UPDATE tracks SET in_library = 1;",
        )
        .unwrap();
    database
}

#[test]
fn lists_only_played_tracks_with_all_fields_in_count_and_title_order() {
    let database = database();
    assert!(database.list_playback_statistics().unwrap().is_empty());
    for id in [3, 2, 1, 3] {
        assert!(database.record_track_play(id).unwrap());
    }
    let result = database.list_playback_statistics().unwrap();
    assert_eq!(
        result
            .iter()
            .map(|track| (track.track_id, track.play_count))
            .collect::<Vec<_>>(),
        vec![(3, 2), (1, 1), (2, 1)]
    );
    assert_eq!(result[1].title.as_deref(), Some("Alpha"));
    assert_eq!(result[1].artist.as_deref(), Some("Artist A"));
    assert_eq!(result[1].album.as_deref(), Some("Album A"));
    database
        .connection()
        .unwrap()
        .execute("UPDATE tracks SET album = 'Changed' WHERE id = 1", [])
        .unwrap();
    assert_eq!(
        database.list_playback_statistics().unwrap()[1]
            .album
            .as_deref(),
        Some("Changed")
    );
}

#[test]
fn deletion_cascades_and_reimport_starts_at_zero_even_with_a_queued_completion() {
    let database = database();
    database.record_track_play(1).unwrap();
    database
        .connection()
        .unwrap()
        .execute("DELETE FROM tracks WHERE id = 1", [])
        .unwrap();
    assert!(!database.record_track_play(1).unwrap());
    assert!(database.list_playback_statistics().unwrap().is_empty());
    let connection = database.connection().unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path, title, in_library) VALUES ('a.mp3', 'Alpha', 1)",
            [],
        )
        .unwrap();
    let new_id = connection.last_insert_rowid();
    assert_ne!(new_id, 1);
    drop(connection);
    assert!(database.list_playback_statistics().unwrap().is_empty());
    database.record_track_play(new_id).unwrap();
    assert_eq!(
        database.list_playback_statistics().unwrap()[0].play_count,
        1
    );
}

#[test]
fn database_failures_do_not_modify_existing_statistics() {
    let database = database();
    database.record_track_play(1).unwrap();
    database
        .connection()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_statistics BEFORE UPDATE ON track_play_statistics
         BEGIN SELECT RAISE(ABORT, 'write failed'); END;",
        )
        .unwrap();
    assert!(database.record_track_play(1).is_err());
    assert_eq!(
        database.list_playback_statistics().unwrap()[0].play_count,
        1
    );
}

#[test]
fn counts_survive_a_database_restart() {
    let path = std::env::temp_dir().join(format!(
        "newbee-play-statistics-{}-{}.sqlite3",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    {
        let database = Database::open(&path).unwrap();
        database
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO tracks (path, in_library) VALUES ('song.mp3', 1)",
                [],
            )
            .unwrap();
        database.record_track_play(1).unwrap();
    }
    {
        let database = Database::open(&path).unwrap();
        assert_eq!(
            database.list_playback_statistics().unwrap()[0].play_count,
            1
        );
    }
    std::fs::remove_file(path).unwrap();
}

#[test]
fn external_plays_are_ignored_and_removing_membership_clears_counts() {
    let database = database();
    database.record_track_play(1).unwrap();
    database.remove_track_from_library(1).unwrap();
    assert!(!database.record_track_play(1).unwrap());
    assert!(database.list_playback_statistics().unwrap().is_empty());
    database
        .connection()
        .unwrap()
        .execute("UPDATE tracks SET in_library = 1 WHERE id = 1", [])
        .unwrap();
    assert!(database.list_playback_statistics().unwrap().is_empty());
    assert!(database.record_track_play(1).unwrap());
    assert_eq!(
        database.list_playback_statistics().unwrap()[0].play_count,
        1
    );
}
