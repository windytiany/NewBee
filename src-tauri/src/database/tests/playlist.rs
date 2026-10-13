use super::super::Database;
use super::support::insert_track;

#[test]
fn renaming_playlist_trims_name_and_preserves_items_and_allows_duplicates() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    let duplicate_name_id = database.create_playlist("Renamed").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    database
        .append_playlist_tracks(playlist_id, vec![2])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    let original_items = database.list_playlist_tracks(playlist_id).unwrap();

    database
        .rename_playlist(playlist_id, "  Renamed  ")
        .unwrap();

    let playlists = database.list_playlists().unwrap();
    assert_eq!(
        playlists
            .iter()
            .filter(|playlist| playlist.name == "Renamed")
            .count(),
        2
    );
    let renamed_playlist = playlists
        .iter()
        .find(|playlist| playlist.id == playlist_id)
        .unwrap();
    assert_eq!(renamed_playlist.name, "Renamed");
    assert_eq!(renamed_playlist.cover_track_id, Some(2));
    assert_eq!(
        database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>(),
        original_items
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>()
    );
    assert_eq!(
        database
            .rename_playlist(duplicate_name_id, "  ")
            .unwrap_err(),
        "Playlist name cannot be empty"
    );
    assert_eq!(
        database.rename_playlist(99, "Missing").unwrap_err(),
        "Playlist 99 was not found"
    );
}

#[test]
fn deleting_playlist_cascades_items_but_preserves_tracks_and_other_playlists() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("To delete").unwrap();
    let other_playlist_id = database.create_playlist("Keep").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(other_playlist_id, vec![2])
        .unwrap();
    let other_item_id =
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;
    let foreign_keys_enabled: i64 = database
        .connection()
        .unwrap()
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .unwrap();
    assert_eq!(foreign_keys_enabled, 1);

    database.delete_playlist(playlist_id).unwrap();

    assert_eq!(
        database
            .list_playlists()
            .unwrap()
            .iter()
            .map(|playlist| playlist.id)
            .collect::<Vec<_>>(),
        vec![other_playlist_id]
    );
    assert!(database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .is_empty());
    assert_eq!(
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id,
        other_item_id
    );
    assert!(database.get_track(1).unwrap().is_some());
    assert!(database.get_track(2).unwrap().is_some());
    assert_eq!(
        database.delete_playlist(99).unwrap_err(),
        "Playlist 99 was not found"
    );
}

#[test]
fn adding_tracks_appends_to_playlist_and_allows_duplicates() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);

    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![2])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();

    let tracks = database.list_playlist_tracks(playlist_id).unwrap();
    assert_eq!(
        tracks
            .iter()
            .map(|track| track.track_id)
            .collect::<Vec<_>>(),
        vec![1, 2, 1]
    );
    assert_eq!(database.list_playlists().unwrap()[0].track_count, 3);
    assert_eq!(
        serde_json::to_value(
            database
                .append_playlist_tracks(playlist_id, vec![99])
                .unwrap()
        )
        .unwrap(),
        serde_json::json!([{ "index": 0, "trackId": 99, "status": "failed", "error": "Track 99 was not found" }])
    );
    assert_eq!(
        database.append_playlist_tracks(99, vec![1]).unwrap_err(),
        "Playlist 99 was not found"
    );
}

#[test]
fn playlist_cover_uses_first_item_by_position_then_id() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Cover").unwrap();
    let empty_playlist_id = database.create_playlist("Empty").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    insert_track(&database, 3, Some("Artist"), Some("Album"), 3, None);
    {
        let connection = database.connection().unwrap();
        connection
            .execute(
                "INSERT INTO playlist_items (id, playlist_id, track_id, position)
                 VALUES (20, ?1, 2, 0), (10, ?1, 1, 0), (30, ?1, 3, 1)",
                [playlist_id],
            )
            .unwrap();
    }

    let playlists = database.list_playlists().unwrap();
    let playlist = playlists
        .iter()
        .find(|playlist| playlist.id == playlist_id)
        .unwrap();
    let empty_playlist = playlists
        .iter()
        .find(|playlist| playlist.id == empty_playlist_id)
        .unwrap();
    assert_eq!(playlist.track_count, 3);
    assert_eq!(playlist.cover_track_id, Some(1));
    assert_eq!(empty_playlist.cover_track_id, None);

    let item_ids = database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .iter()
        .map(|item| item.playlist_item_id)
        .collect::<Vec<_>>();
    database
        .remove_playlist_items(playlist_id, vec![item_ids[0]])
        .unwrap();
    let updated_playlist = database
        .list_playlists()
        .unwrap()
        .into_iter()
        .find(|entry| entry.id == playlist_id)
        .unwrap();
    assert_eq!(updated_playlist.cover_track_id, Some(2));
}

#[test]
fn remove_playlist_items_validates_all_ids_before_deleting() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    let other_playlist_id = database.create_playlist("Other").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![2])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(other_playlist_id, vec![2])
        .unwrap();
    let playlist_items = database.list_playlist_tracks(playlist_id).unwrap();
    let other_playlist_item_id =
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;
    let original_ids = playlist_items
        .iter()
        .map(|item| item.playlist_item_id)
        .collect::<Vec<_>>();

    assert!(database
        .remove_playlist_items(playlist_id, vec![original_ids[0], original_ids[0]])
        .is_err());
    assert!(database
        .remove_playlist_items(playlist_id, vec![original_ids[0], other_playlist_item_id])
        .is_err());
    assert_eq!(
        database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>(),
        original_ids
    );

    database.remove_playlist_items(playlist_id, vec![]).unwrap();
    database
        .remove_playlist_items(playlist_id, vec![original_ids[0]])
        .unwrap();
    let remaining_items = database.list_playlist_tracks(playlist_id).unwrap();
    assert_eq!(
        remaining_items
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>(),
        vec![original_ids[1], original_ids[2]]
    );
    assert!(database.get_track(1).unwrap().is_some());
    assert_eq!(
        database.remove_playlist_items(99, vec![]).unwrap_err(),
        "Playlist 99 was not found"
    );
}

#[test]
fn removing_one_duplicate_playlist_item_preserves_its_siblings_and_tracks() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    let other_playlist_id = database.create_playlist("Other").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(other_playlist_id, vec![1])
        .unwrap();

    let duplicate_ids = database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .iter()
        .map(|item| item.playlist_item_id)
        .collect::<Vec<_>>();
    let other_item_id =
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;
    database
        .remove_playlist_items(playlist_id, vec![duplicate_ids[1]])
        .unwrap();

    let remaining_items = database.list_playlist_tracks(playlist_id).unwrap();
    assert_eq!(remaining_items.len(), 1);
    assert_eq!(remaining_items[0].playlist_item_id, duplicate_ids[0]);
    assert_eq!(remaining_items[0].track_id, 1);
    assert_eq!(
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id,
        other_item_id
    );
    assert!(database.get_track(1).unwrap().is_some());
    assert!(database.get_track(2).unwrap().is_some());
}

#[test]
fn reorder_playlist_items_requires_exact_ids_and_rolls_back_failures() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    let other_playlist_id = database.create_playlist("Other").unwrap();
    let empty_playlist_id = database.create_playlist("Empty").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![2])
        .unwrap();
    database
        .append_playlist_tracks(playlist_id, vec![1])
        .unwrap();
    database
        .append_playlist_tracks(other_playlist_id, vec![2])
        .unwrap();
    let item_ids = database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .iter()
        .map(|item| item.playlist_item_id)
        .collect::<Vec<_>>();
    let other_item_id =
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;

    let duplicate_error = database
        .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[0], item_ids[2]])
        .unwrap_err();
    assert_eq!(
        serde_json::to_value(duplicate_error).unwrap(),
        serde_json::json!({
            "code": "failed",
            "message": "Playlist item IDs must not contain duplicates"
        })
    );
    assert!(database
        .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[1], other_item_id])
        .is_err());
    let mismatch_error = database
        .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[1]])
        .unwrap_err();
    let serialized_error = serde_json::to_value(mismatch_error).unwrap();
    assert_eq!(serialized_error["code"], "item_set_mismatch");
    assert!(serialized_error["message"]
        .as_str()
        .is_some_and(|message| !message.is_empty()));
    assert!(database
        .reorder_playlist_items(
            playlist_id,
            vec![item_ids[0], item_ids[1], item_ids[2], 999]
        )
        .is_err());
    assert_eq!(
        database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>(),
        item_ids
    );

    let connection = database.connection().unwrap();
    connection
        .execute_batch(&format!(
            "CREATE TRIGGER fail_playlist_reorder
             BEFORE UPDATE OF position ON playlist_items
             WHEN NEW.id = {} AND NEW.position = 1
             BEGIN SELECT RAISE(ABORT, 'test reorder failure'); END;",
            item_ids[1]
        ))
        .unwrap();
    drop(connection);
    assert!(database
        .reorder_playlist_items(playlist_id, vec![item_ids[2], item_ids[1], item_ids[0]])
        .is_err());
    assert_eq!(
        database
            .list_playlist_tracks(playlist_id)
            .unwrap()
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<Vec<_>>(),
        item_ids
    );
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_playlist_reorder")
        .unwrap();

    database
        .reorder_playlist_items(playlist_id, vec![item_ids[2], item_ids[1], item_ids[0]])
        .unwrap();
    database
        .reorder_playlist_items(empty_playlist_id, vec![])
        .unwrap();
    let reordered_ids = database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .iter()
        .map(|item| item.playlist_item_id)
        .collect::<Vec<_>>();
    assert_eq!(reordered_ids, vec![item_ids[2], item_ids[1], item_ids[0]]);
    let connection = database.connection().unwrap();
    let mut statement = connection
        .prepare("SELECT position FROM playlist_items WHERE playlist_id = ?1 ORDER BY position")
        .unwrap();
    let positions = statement
        .query_map([playlist_id], |row| row.get::<_, i64>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(positions, vec![0, 1, 2]);
}

#[test]
fn batch_append_preserves_order_duplicates_and_each_failure_after_existing_reordered_items() {
    let database = Database::open(":memory:").unwrap();
    let playlist = database.create_playlist("Batch").unwrap();
    for id in 1..=3 {
        insert_track(&database, id, None, None, id, None);
    }
    database
        .append_playlist_tracks(playlist, vec![1, 2])
        .unwrap();
    let before = database.list_playlist_tracks(playlist).unwrap();
    database
        .reorder_playlist_items(
            playlist,
            vec![before[1].playlist_item_id, before[0].playlist_item_id],
        )
        .unwrap();
    let results = database
        .append_playlist_tracks(playlist, vec![3, 99, 1, 3])
        .unwrap();
    let json = serde_json::to_value(&results).unwrap();
    assert_eq!(
        json[1],
        serde_json::json!({"index":1,"trackId":99,"status":"failed","error":"Track 99 was not found"})
    );
    for index in [0, 2, 3] {
        assert_eq!(json[index]["index"], index);
        assert_eq!(json[index]["status"], "added");
    }
    let items = database.list_playlist_tracks(playlist).unwrap();
    assert_eq!(
        items.iter().map(|item| item.track_id).collect::<Vec<_>>(),
        [2, 1, 3, 1, 3]
    );
    assert_eq!(
        items
            .iter()
            .map(|item| item.playlist_item_id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        5
    );
    assert_eq!(json[0]["playlistItemId"], items[2].playlist_item_id);
    assert_eq!(json[2]["playlistItemId"], items[3].playlist_item_id);
    assert_eq!(json[3]["playlistItemId"], items[4].playlist_item_id);
    let connection = database.connection().unwrap();
    let mut statement = connection
        .prepare("SELECT position FROM playlist_items WHERE playlist_id = ?1 ORDER BY position, id")
        .unwrap();
    let positions = statement
        .query_map([playlist], |row| row.get::<_, i64>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(positions, [0, 1, 2, 3, 4]);
}

#[test]
fn batch_append_rolls_back_failed_item_trigger_side_effects_and_continues() {
    let database = Database::open(":memory:").unwrap();
    let playlist = database.create_playlist("Batch").unwrap();
    for id in 1..=2 {
        insert_track(&database, id, None, None, id, None);
    }
    database.connection().unwrap().execute_batch(
        "CREATE TABLE append_effects (track_id INTEGER);
         CREATE TRIGGER fail_append BEFORE INSERT ON playlist_items WHEN NEW.track_id = 2
         BEGIN INSERT INTO append_effects VALUES (NEW.track_id); SELECT RAISE(FAIL, 'item rejected'); END;"
    ).unwrap();
    let results = serde_json::to_value(
        database
            .append_playlist_tracks(playlist, vec![1, 2, 1])
            .unwrap(),
    )
    .unwrap();
    assert_eq!(results[0]["status"], "added");
    assert_eq!(results[1]["status"], "failed");
    assert!(results[1]["error"]
        .as_str()
        .unwrap()
        .contains("item rejected"));
    assert_eq!(results[2]["status"], "added");
    assert_eq!(
        database
            .list_playlist_tracks(playlist)
            .unwrap()
            .iter()
            .map(|item| item.track_id)
            .collect::<Vec<_>>(),
        [1, 1]
    );
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM append_effects", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn batch_append_commit_failure_returns_no_success_and_rolls_back_every_item() {
    let database = Database::open(":memory:").unwrap();
    let playlist = database.create_playlist("Batch").unwrap();
    insert_track(&database, 1, None, None, 1, None);
    database.append_playlist_tracks(playlist, vec![1]).unwrap();
    let original = database.list_playlist_tracks(playlist).unwrap()[0].playlist_item_id;
    database.connection().unwrap().execute_batch(
        "CREATE TABLE append_commit (track_id INTEGER REFERENCES tracks(id) DEFERRABLE INITIALLY DEFERRED);
         CREATE TRIGGER fail_commit AFTER INSERT ON playlist_items
         BEGIN INSERT INTO append_commit VALUES (999); END;"
    ).unwrap();
    let error = database
        .append_playlist_tracks(playlist, vec![1, 1])
        .unwrap_err();
    assert!(
        error.contains("Failed to finish playlist update"),
        "{error}"
    );
    let items = database.list_playlist_tracks(playlist).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].playlist_item_id, original);
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM append_commit", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn batch_append_missing_playlist_rejects_entire_request_without_inserting() {
    let database = Database::open(":memory:").unwrap();
    insert_track(&database, 1, None, None, 1, None);
    assert_eq!(
        database
            .append_playlist_tracks(99, vec![1, 1, 999])
            .unwrap_err(),
        "Playlist 99 was not found"
    );
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM playlist_items", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
