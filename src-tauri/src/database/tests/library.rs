use super::super::Database;
use super::support::insert_track;
use crate::artwork::model::TrackArtwork;
use crate::settings::{AlbumSortBy, AlbumSortOrder};
use rusqlite::params;

#[test]
fn album_tracks_expose_disc_and_track_numbers_in_disc_order() {
    let database = Database::open(":memory:").unwrap();
    for (id, disc, track) in [
        (1, Some(2), Some(1)),
        (2, Some(1), Some(4)),
        (3, Some(1), Some(1)),
        (4, None, None),
    ] {
        insert_track(&database, id, Some("Artist"), Some("Album"), 1, None);
        database
            .connection()
            .unwrap()
            .execute(
                "UPDATE tracks SET disc_number = ?1, track_number = ?2 WHERE id = ?3",
                params![disc, track, id],
            )
            .unwrap();
    }
    let tracks = database
        .list_album_tracks(Some("Artist".to_owned()), Some("Album".to_owned()))
        .unwrap();
    assert_eq!(
        tracks
            .iter()
            .map(|track| (track.id, track.disc_number, track.track_number))
            .collect::<Vec<_>>(),
        vec![
            (3, Some(1), Some(1)),
            (2, Some(1), Some(4)),
            (1, Some(2), Some(1)),
            (4, None, None),
        ]
    );
    let serialized = serde_json::to_value(&tracks[2]).unwrap();
    assert_eq!(serialized["discNumber"], 2);
    assert_eq!(serialized["trackNumber"], 1);
}

#[test]
fn album_date_sorting_uses_full_dates_but_exposes_only_the_year() {
    let database = Database::open(":memory:").unwrap();
    for (id, album, release_date) in [
        (1, "STUDY WITH MIKU part1", Some("2023-08-09")),
        (2, "STUDY WITH MIKU part2", Some("2023-08-25")),
        (3, "STUDY WITH MIKU part6", Some("2026-01-01")),
        (4, "Later month", Some("2023-12-01")),
        (5, "Year only", Some("2023")),
        (6, "Month only", Some("2023-08")),
        (7, "No date", None),
        (8, "Invalid date", Some("unknown")),
        (9, "STUDY WITH MIKU part2", Some("2023-09-01")),
    ] {
        insert_track(&database, id, Some("Artist"), Some(album), 1, None);
        database
            .connection()
            .unwrap()
            .execute(
                "UPDATE tracks SET release_date = ?1 WHERE id = ?2",
                params![release_date, id],
            )
            .unwrap();
    }
    for (sort_order, expected) in [
        (
            AlbumSortOrder::Ascending,
            vec![
                "Year only",
                "Month only",
                "STUDY WITH MIKU part1",
                "STUDY WITH MIKU part2",
                "Later month",
                "STUDY WITH MIKU part6",
                "Invalid date",
                "No date",
            ],
        ),
        (
            AlbumSortOrder::Descending,
            vec![
                "STUDY WITH MIKU part6",
                "Later month",
                "STUDY WITH MIKU part2",
                "STUDY WITH MIKU part1",
                "Month only",
                "Year only",
                "Invalid date",
                "No date",
            ],
        ),
    ] {
        let albums = database
            .list_albums(Some("Artist".to_owned()), AlbumSortBy::Year, sort_order)
            .unwrap();
        assert_eq!(
            albums
                .iter()
                .map(|album| album.album.as_deref().unwrap())
                .collect::<Vec<_>>(),
            expected,
            "{sort_order:?}",
        );
        for album in &albums {
            let expected_year = match album.album.as_deref().unwrap() {
                "STUDY WITH MIKU part6" => Some(2026),
                "No date" | "Invalid date" => None,
                _ => Some(2023),
            };
            assert_eq!(album.year, expected_year);
            assert!(serde_json::to_value(album)
                .unwrap()
                .get("releaseDate")
                .is_none());
        }
    }
}

#[test]
fn album_sorting_supports_names_years_and_both_directions() {
    let database = Database::open(":memory:").unwrap();
    for (id, album, release_date) in [
        (1, Some("Zulu"), Some("1990-01-01")),
        (2, Some("alpha"), Some("2024")),
        (3, Some("Bravo"), Some("2024-06-01")),
        (4, Some("No year"), None),
        (5, Some("Invalid year"), Some("unknown")),
        (6, None, Some("2010")),
        (7, Some("Zulu"), Some("2000")),
    ] {
        insert_track(&database, id, Some("Artist"), album, 1, None);
        database
            .connection()
            .unwrap()
            .execute(
                "UPDATE tracks SET release_date = ?1 WHERE id = ?2",
                params![release_date, id],
            )
            .unwrap();
    }
    insert_track(
        &database,
        8,
        Some("Other artist"),
        Some("Excluded"),
        1,
        None,
    );
    for (sort_by, sort_order, expected) in [
        (
            AlbumSortBy::Name,
            AlbumSortOrder::Ascending,
            vec![
                Some("alpha"),
                Some("Bravo"),
                Some("Invalid year"),
                Some("No year"),
                Some("Zulu"),
                None,
            ],
        ),
        (
            AlbumSortBy::Name,
            AlbumSortOrder::Descending,
            vec![
                Some("Zulu"),
                Some("No year"),
                Some("Invalid year"),
                Some("Bravo"),
                Some("alpha"),
                None,
            ],
        ),
        (
            AlbumSortBy::Year,
            AlbumSortOrder::Ascending,
            vec![
                Some("Zulu"),
                None,
                Some("alpha"),
                Some("Bravo"),
                Some("Invalid year"),
                Some("No year"),
            ],
        ),
        (
            AlbumSortBy::Year,
            AlbumSortOrder::Descending,
            vec![
                Some("Bravo"),
                Some("alpha"),
                None,
                Some("Zulu"),
                Some("Invalid year"),
                Some("No year"),
            ],
        ),
    ] {
        let albums = database
            .list_albums(Some("Artist".to_owned()), sort_by, sort_order)
            .unwrap();
        assert_eq!(
            albums
                .iter()
                .map(|album| album.album.as_deref())
                .collect::<Vec<_>>(),
            expected,
            "{sort_by:?} {sort_order:?}",
        );
        assert_eq!(
            albums
                .iter()
                .find(|album| album.album.as_deref() == Some("Zulu"))
                .unwrap()
                .year,
            Some(1990)
        );
    }
    let unknown_artist = database
        .list_albums(None, AlbumSortBy::Year, AlbumSortOrder::Descending)
        .unwrap();
    assert!(unknown_artist.is_empty());
}

#[test]
fn removing_track_cascades_playlist_items_without_deleting_the_file() {
    let database = Database::open(":memory:").unwrap();
    let playlist_id = database.create_playlist("Favorites").unwrap();
    let path = std::env::temp_dir().join(format!(
        "newbee-delete-track-{}-{}.mp3",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::write(&path, b"audio remains on disk").unwrap();
    let path_string = path.to_string_lossy().into_owned();
    database
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO tracks (id, path, title) VALUES (1, ?1, 'Track')",
            [&path_string],
        )
        .unwrap();
    database
        .connection()
        .unwrap()
        .execute(
            "INSERT INTO artwork_images (mime_type, digest, image) VALUES ('image/png', zeroblob(32), X'0102')",
            [],
        )
        .unwrap();
    database.connection().unwrap().execute("INSERT INTO track_artwork (track_id, image_id, source_kind, source_path) VALUES (1, 1, 'embedded', ?1)", [&path_string]).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();
    database.add_track_to_playlist(playlist_id, 1).unwrap();

    database.remove_track_from_library(1).unwrap();

    assert!(database.get_track(1).unwrap().is_none());
    assert!(database.get_track_artwork(1).unwrap().is_none());
    assert!(database
        .list_playlist_tracks(playlist_id)
        .unwrap()
        .is_empty());
    assert_eq!(database.list_playlists().unwrap()[0].track_count, 0);
    assert_eq!(std::fs::read(&path).unwrap(), b"audio remains on disk");
    std::fs::remove_file(path).unwrap();
    assert_eq!(
        database.remove_track_from_library(1).unwrap_err(),
        "Track 1 was not found"
    );
}

#[test]
fn get_album_artwork_returns_first_available_cover_and_matches_null_metadata() {
    let database = Database::open(":memory:").unwrap();
    insert_track(&database, 1, Some("Artist"), Some("Album"), 1, None);
    insert_track(
        &database,
        2,
        Some("Artist"),
        Some("Album"),
        2,
        Some(&[2, 3]),
    );
    insert_track(
        &database,
        3,
        Some("Artist"),
        Some("Album"),
        3,
        Some(&[4, 5]),
    );
    insert_track(&database, 4, None, None, 1, Some(&[6, 7]));

    let artwork = database
        .get_album_artwork(Some("Artist".to_owned()), Some("Album".to_owned()))
        .unwrap();
    assert!(matches!(
        artwork,
        Some(TrackArtwork::Available { mime_type, data })
            if mime_type == "image/png" && data == vec![2, 3]
    ));

    let artwork = database.get_album_artwork(None, None).unwrap();
    assert!(matches!(
        artwork,
        Some(TrackArtwork::Available { data, .. }) if data == vec![6, 7]
    ));

    assert!(database
        .get_album_artwork(Some("Missing".to_owned()), Some("Album".to_owned()))
        .unwrap()
        .is_none());
}
