use super::*;

#[test]
fn thumbnail_derivation_does_not_block_metadata_reads() {
    use std::sync::mpsc;
    use std::time::Duration;

    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(&database, 1, None, None, 1, Some(b"original"));
    std::thread::scope(|scope| {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let database = &database;
        let derivation = scope.spawn(move || {
            database.track_artwork_bytes(1, Some(512), |original, size| {
                assert_eq!(original, b"original");
                assert_eq!(size, 512);
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"thumbnail".to_vec())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (metadata_tx, metadata_rx) = mpsc::channel();
        scope.spawn(move || {
            metadata_tx.send(database.get_track(1)).unwrap();
        });
        let metadata = metadata_rx.recv_timeout(Duration::from_secs(5));
        // Always release before asserting, so a regression fails instead of hanging.
        release_tx.send(()).unwrap();
        assert_eq!(derivation.join().unwrap().unwrap(), b"thumbnail");
        assert!(metadata
            .expect("metadata read blocked by thumbnail derivation")
            .unwrap()
            .is_some());
    });
}

#[test]
fn concurrent_track_and_album_requests_share_one_thumbnail() {
    use std::sync::mpsc;
    use std::time::Duration;

    let database = Database::open(":memory:").unwrap();
    for id in [1, 2] {
        super::support::insert_track(
            &database,
            id,
            Some("Artist"),
            Some("Album"),
            id,
            Some(b"original"),
        );
    }
    std::thread::scope(|scope| {
        let database = &database;
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = scope.spawn(move || {
            database.track_artwork_bytes(1, Some(512), |_, _| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"shared thumbnail".to_vec())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (requested_tx, requested_rx) = mpsc::channel();
        let track_tx = requested_tx.clone();
        let track = scope.spawn(move || {
            track_tx.send(()).unwrap();
            database.track_artwork_bytes(2, Some(512), |_, _| panic!("shared image derived twice"))
        });
        let album = scope.spawn(move || {
            requested_tx.send(()).unwrap();
            database.album_artwork_bytes(
                Some("Artist".into()),
                Some("Album".into()),
                Some(512),
                |_, _| panic!("album derived shared image again"),
            )
        });
        let requested = (0..2).try_for_each(|_| requested_rx.recv_timeout(Duration::from_secs(5)));
        release_tx.send(()).unwrap();
        requested.unwrap();
        for request in [first, track, album] {
            assert_eq!(request.join().unwrap().unwrap(), b"shared thumbnail");
        }
    });
}

fn artwork_during_update(
    database: &Database,
    album: bool,
    update: impl FnOnce(&Database) + Send,
) -> Result<Vec<u8>, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    std::thread::scope(|scope| {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let derivation = scope.spawn(move || {
            let derive = |_, _| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"obsolete thumbnail".to_vec())
            };
            if album {
                database.album_artwork_bytes(
                    Some("Artist".into()),
                    Some("Album".into()),
                    Some(512),
                    derive,
                )
            } else {
                database.track_artwork_bytes(1, Some(512), derive)
            }
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (updated_tx, updated_rx) = mpsc::channel();
        let updating = scope.spawn(move || {
            update(database);
            updated_tx.send(()).unwrap();
        });
        let updated = updated_rx.recv_timeout(Duration::from_secs(5));
        release_tx.send(()).unwrap();
        updating.join().unwrap();
        updated.expect("association update blocked by thumbnail derivation");
        derivation.join().unwrap()
    })
}

#[test]
fn association_replacement_during_derivation_does_not_publish_old_thumbnail() {
    let database = Database::open(":memory:").unwrap();
    for id in [1, 2] {
        super::support::insert_track(&database, id, None, None, id, Some(b"original"));
    }
    let result = artwork_during_update(&database, false, |database| {
        database
            .update_metadata_cover_and_lyrics(
                1,
                &[],
                Some(Some(&crate::artwork::model::ArtworkContent {
                    mime_type: "image/png".into(),
                    image: b"replacement".to_vec(),
                })),
                None,
                crate::metadata::model::LyricsMarkAction::Keep,
                None,
            )
            .unwrap();
    });
    assert!(result.unwrap_err().contains("Artwork changed"));
    assert_eq!(
        database
            .track_artwork_bytes(1, Some(512), |original, _| {
                assert_eq!(original, b"replacement");
                Ok(b"new thumbnail".to_vec())
            })
            .unwrap(),
        b"new thumbnail"
    );
    // The old image still belongs to another track, but the obsolete request
    // must not have published its derived bytes even there.
    assert_eq!(
        database
            .track_artwork_bytes(2, Some(512), |original, _| {
                assert_eq!(original, b"original");
                Ok(b"other thumbnail".to_vec())
            })
            .unwrap(),
        b"other thumbnail"
    );
}

#[test]
fn association_removal_during_derivation_returns_no_artwork() {
    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(&database, 1, None, None, 1, Some(b"original"));
    let result = artwork_during_update(&database, false, |database| {
        database
            .connection()
            .unwrap()
            .execute("DELETE FROM track_artwork WHERE track_id = 1", [])
            .unwrap();
    });
    assert!(result.unwrap().is_empty());
    assert!(database
        .track_artwork_bytes(1, Some(512), |_, _| panic!("removed artwork derived"))
        .unwrap()
        .is_empty());
}

#[test]
fn album_selection_change_during_derivation_does_not_return_old_thumbnail() {
    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(
        &database,
        1,
        Some("Artist"),
        Some("Album"),
        1,
        Some(b"first"),
    );
    super::support::insert_track(
        &database,
        2,
        Some("Artist"),
        Some("Album"),
        2,
        Some(b"second"),
    );
    let result = artwork_during_update(&database, true, |database| {
        database
            .update_metadata_cover_and_lyrics(
                1,
                &[crate::metadata::model::MetadataChange {
                    values: Vec::new(),
                    field: crate::metadata::model::MetadataField::Album,
                    value: Some("Other album".into()),
                }],
                None,
                None,
                crate::metadata::model::LyricsMarkAction::Keep,
                None,
            )
            .unwrap();
    });
    assert!(result.unwrap_err().contains("Artwork changed"));
    assert_eq!(
        database
            .album_artwork_bytes(
                Some("Artist".into()),
                Some("Album".into()),
                Some(512),
                |original, _| {
                    assert_eq!(original, b"second");
                    Ok(b"current album thumbnail".to_vec())
                }
            )
            .unwrap(),
        b"current album thumbnail"
    );
}

#[test]
fn cold_thumbnail_derivation_does_not_block_cached_thumbnails_or_originals() {
    use std::sync::mpsc;
    use std::time::Duration;

    let database = Database::open(":memory:").unwrap();
    super::support::insert_track(&database, 1, None, None, 1, Some(b"original"));
    database
        .track_artwork_bytes(1, Some(128), |_, _| Ok(b"cached thumbnail".to_vec()))
        .unwrap();
    std::thread::scope(|scope| {
        let database = &database;
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let cold = scope.spawn(move || {
            database.track_artwork_bytes(1, Some(512), |_, _| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(b"cold thumbnail".to_vec())
            })
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (warm_tx, warm_rx) = mpsc::channel();
        scope.spawn(move || {
            let original = database.track_artwork_bytes(1, None, |_, _| panic!("original derived"));
            let cached = database
                .track_artwork_bytes(1, Some(128), |_, _| panic!("cached thumbnail derived"));
            warm_tx.send((original, cached)).unwrap();
        });
        let warm = warm_rx.recv_timeout(Duration::from_secs(5));
        release_tx.send(()).unwrap();
        assert_eq!(cold.join().unwrap().unwrap(), b"cold thumbnail");
        let (original, cached) = warm.expect("warm/original request blocked by cold derivation");
        assert_eq!(original.unwrap(), b"original");
        assert_eq!(cached.unwrap(), b"cached thumbnail");
    });
}

use super::support::insert_track;
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
