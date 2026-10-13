use crate::database::{tests::support::insert_track, Database};
use std::fs;

#[test]
fn failed_generation_is_not_cached_and_does_not_poison_the_decode_gate() {
    let database = Database::open(":memory:").unwrap();
    insert_track(&database, 1, None, None, 1, Some(b"snapshot"));
    for _ in 0..2 {
        assert_eq!(
            database
                .track_artwork_bytes(1, Some(128), |_, _| Err("encoding failed".into()))
                .unwrap_err(),
            "encoding failed"
        );
    }
    assert_eq!(
        database
            .track_artwork_bytes(1, None, |_, _| panic!("original derived"))
            .unwrap(),
        b"snapshot"
    );
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |_, _| Ok(b"thumbnail".to_vec()))
            .unwrap(),
        b"thumbnail"
    );
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |_, _| panic!(
                "successful generation was not cached"
            ))
            .unwrap(),
        b"thumbnail"
    );
    assert!(database
        .track_artwork_bytes(1, Some(333), |_, _| panic!("arbitrary size derived"))
        .is_err());
}

#[test]
fn deleting_the_cache_directory_rebuilds_without_reopening_or_reading_music() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join("cache");
    let database = Database::open_with_cache(":memory:", &cache).unwrap();
    insert_track(&database, 1, None, None, 1, Some(b"offline snapshot"));
    database
        .track_artwork_bytes(1, Some(128), |_, _| Ok(b"old thumbnail".to_vec()))
        .unwrap();
    fs::remove_dir_all(&cache).unwrap();
    database.clean_artwork_cache().unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |data, _| {
                assert_eq!(data, b"offline snapshot");
                Ok(b"rebuilt thumbnail".to_vec())
            })
            .unwrap(),
        b"rebuilt thumbnail"
    );
    assert_eq!(fs::read_dir(&cache).unwrap().count(), 1);
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(128), |_, _| panic!("rebuilt entry missed"))
            .unwrap(),
        b"rebuilt thumbnail"
    );
}

#[test]
fn deleting_shared_associations_only_cleans_cache_after_the_last_reference() {
    let directory = tempfile::tempdir().unwrap();
    let cache = directory.path().join("cache");
    let database = Database::open_with_cache(":memory:", &cache).unwrap();
    for id in [1, 2] {
        insert_track(&database, id, None, None, id, Some(b"shared snapshot"));
    }
    database
        .track_artwork_bytes(1, Some(128), |_, _| Ok(b"shared thumbnail".to_vec()))
        .unwrap();
    database
        .connection()
        .unwrap()
        .execute("DELETE FROM track_artwork WHERE track_id = 1", [])
        .unwrap();
    database.clean_artwork_cache().unwrap();
    assert_eq!(
        database
            .track_artwork_bytes(2, Some(128), |_, _| panic!("shared image evicted"))
            .unwrap(),
        b"shared thumbnail"
    );
    database
        .connection()
        .unwrap()
        .execute("DELETE FROM track_artwork WHERE track_id = 2", [])
        .unwrap();
    database.clean_artwork_cache().unwrap();
    assert_eq!(fs::read_dir(cache).unwrap().count(), 0);
}
