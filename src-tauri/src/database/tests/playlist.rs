use super::super::Database;
use super::support::insert_track;

#[test]
fn renaming_playlist_trims_name_and_preserves_items_and_allows_duplicates() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    let duplicate_name_id = database.create_playlist("Renamed").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(&database, 2, Some("Artist"), Some("Album"), 2, None);
    database.add_track_to_playlist(playlist_id, 2).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
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
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database
        .add_track_to_playlist(other_playlist_id, 2)
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

    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 2).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();

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
        database.add_track_to_playlist(playlist_id, 99).unwrap_err(),
        "Track 99 was not found"
    );
    assert_eq!(
        database.add_track_to_playlist(99, 1).unwrap_err(),
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
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 2).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database
        .add_track_to_playlist(other_playlist_id, 2)
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
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database
        .add_track_to_playlist(other_playlist_id, 1)
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
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 2).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database
        .add_track_to_playlist(other_playlist_id, 2)
        .unwrap();
    let item_ids = database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .iter()
        .map(|item| item.playlist_item_id)
        .collect::<Vec<_>>();
    let other_item_id =
        database.list_playlist_tracks(other_playlist_id).unwrap()[0].playlist_item_id;

    assert!(database
        .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[0], item_ids[2]])
        .is_err());
    assert!(database
        .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[1], other_item_id])
        .is_err());
    assert!(database
        .reorder_playlist_items(playlist_id, vec![item_ids[0], item_ids[1]])
        .is_err());
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
