use super::super::Database;
use crate::artwork::track::TrackArtwork;
use crate::library::model::{LibraryGroup, LibraryGrouping};
use crate::metadata::model::LyricsMarkAction;
use crate::settings::{AlbumSortBy, AlbumSortOrder};
use crate::tracks::model::{TrackWriteInput, TrackWriteOutcome};

fn snapshot(path: &str, artist: Option<&str>, album: Option<&str>) -> TrackWriteInput {
    TrackWriteInput {
        path: path.into(),
        title: Some("Song".into()),
        artist: artist.map(str::to_owned),
        album: album.map(str::to_owned),
        album_artist: artist.map(str::to_owned),
        release_date: Some("2000".into()),
        disc_number: None,
        track_number: None,
        disc_total: None,
        track_total: None,
        duration_ms: None,
        codec: None,
        sample_rate_hz: None,
        bitrate_kbps: None,
        channels: None,
        editing: None,
        lyrics: Some("embedded lyrics".into()),
    }
}

fn register(database: &Database, track: &TrackWriteInput) -> i64 {
    let mut connection = database.connection().unwrap();
    let transaction = connection.transaction().unwrap();
    let id = super::super::tracks::persist_track(
        &transaction,
        track,
        Some(&crate::database::tests::support::embedded(Some(
            b"cover snapshot",
        ))),
    )
    .unwrap();
    transaction.commit().unwrap();
    id
}

fn albums(
    database: &Database,
    grouping: LibraryGrouping,
    artist: Option<&str>,
) -> Vec<crate::library::model::AlbumSummary> {
    database
        .list_albums(
            LibraryGroup {
                grouping,
                artist: artist.map(str::to_owned),
            },
            AlbumSortBy::Year,
            AlbumSortOrder::Ascending,
        )
        .unwrap()
}

#[test]
fn external_targets_exclude_members_missing_ids_and_duplicates() {
    let database = Database::open(":memory:").unwrap();
    let external = snapshot("external.flac", None, None);
    let external_id = register(&database, &external);
    let member = snapshot("member.flac", None, None);
    database
        .upsert_track(
            &member,
            Some(&crate::database::tests::support::embedded(Some(
                b"cover snapshot",
            ))),
        )
        .unwrap();
    let member_id = register(&database, &member);
    assert_eq!(
        database
            .external_track_ids(&[member_id, external_id, external_id, -1])
            .unwrap(),
        vec![external_id]
    );
    database
        .upsert_track(
            &external,
            Some(&crate::database::tests::support::embedded(Some(
                b"cover snapshot",
            ))),
        )
        .unwrap();
    assert!(database
        .external_track_ids(&[external_id, member_id])
        .unwrap()
        .is_empty());
}

#[test]
fn external_snapshots_do_not_contribute_to_library_queries_or_album_aggregates() {
    let database = Database::open(":memory:").unwrap();
    let external = snapshot("external.flac", Some("Artist"), Some("Album"));
    let external_id = register(&database, &external);
    register(&database, &snapshot("unknown.flac", None, None));
    for grouping in [LibraryGrouping::Artist, LibraryGrouping::AlbumArtist] {
        assert!(database.list_artists(grouping).unwrap().is_empty());
        assert!(albums(&database, grouping, Some("Artist")).is_empty());
        assert!(albums(&database, grouping, None).is_empty());
    }
    assert!(database.library_track_paths().unwrap().is_empty());
    assert!(database
        .list_album_tracks(Some("Artist".into()), Some("Album".into()), None)
        .unwrap()
        .is_empty());
    assert!(database
        .list_album_tracks(None, None, None)
        .unwrap()
        .is_empty());
    assert!(database
        .get_album_artwork(Some("Artist".into()), Some("Album".into()))
        .unwrap()
        .is_none());
    assert!(database
        .album_artwork_bytes(
            Some("Artist".into()),
            Some("Album".into()),
            None,
            |_, _| panic!("external artwork derived")
        )
        .unwrap()
        .is_empty());
    assert!(database.get_track(external_id).unwrap().is_some());

    let mut member = snapshot("member.flac", Some("Artist"), Some("Album"));
    member.release_date = Some("2020".into());
    database
        .upsert_track(
            &member,
            Some(&crate::database::tests::support::embedded(None)),
        )
        .unwrap();
    register(
        &database,
        &snapshot("other.flac", Some("Artist"), Some("Other")),
    );
    for grouping in [LibraryGrouping::Artist, LibraryGrouping::AlbumArtist] {
        let artists = database.list_artists(grouping).unwrap();
        assert_eq!(artists.len(), 1);
        assert_eq!(artists[0].album_count, 1);
        let result = albums(&database, grouping, Some("Artist"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].year, Some(2020));
        let tracks = database
            .list_album_tracks(
                Some("Artist".into()),
                Some("Album".into()),
                Some(LibraryGroup {
                    grouping,
                    artist: Some("Artist".into()),
                }),
            )
            .unwrap();
        assert_eq!(tracks.len(), 1);
        assert_ne!(tracks[0].id, external_id);
    }
    assert_eq!(database.library_track_paths().unwrap(), vec!["member.flac"]);
    assert!(database
        .get_album_artwork(Some("Artist".into()), Some("Album".into()))
        .unwrap()
        .is_none());
    assert!(database
        .album_artwork_bytes(
            Some("Artist".into()),
            Some("Album".into()),
            None,
            |_, _| panic!("external artwork derived")
        )
        .unwrap()
        .is_empty());
}

#[test]
fn membership_transitions_preserve_identity_references_user_data_and_files() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("song.flac");
    std::fs::write(&file, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let file = std::fs::canonicalize(file).unwrap();
    let path = file.to_string_lossy().into_owned();
    let mut track = crate::metadata::files::read_track(&file).unwrap().unwrap();
    track.lyrics = Some("embedded lyrics".into());
    let database = Database::open(directory.path().join("tracks.sqlite3")).unwrap();
    super::support::inbox(
        &database,
        &track,
        super::support::embedded(Some(b"cover snapshot")),
    )
    .unwrap();
    let id = register(&database, &track);
    assert_eq!(register(&database, &track), id);
    let playlist = database.create_playlist("Favorites").unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    database.append_playlist_tracks(playlist, vec![id]).unwrap();
    let entries = serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap();
    assert_ne!(entries[0]["playlistItemId"], entries[1]["playlistItemId"]);
    database.record_track_play(id).unwrap();
    database.set_tracks_skipped(&[id], true).unwrap();
    assert_eq!(database.inbox_paths().unwrap(), vec![path.clone()]);

    assert!(matches!(
        database
            .upsert_track(
                &track,
                Some(&crate::database::tests::support::embedded(Some(
                    b"cover snapshot"
                )))
            )
            .unwrap(),
        TrackWriteOutcome::Added
    ));
    assert!(matches!(
        database
            .upsert_track(
                &track,
                Some(&crate::database::tests::support::embedded(Some(
                    b"cover snapshot"
                )))
            )
            .unwrap(),
        TrackWriteOutcome::Updated
    ));
    assert_eq!(register(&database, &track), id);
    assert_eq!(database.library_track_paths().unwrap(), vec![path.clone()]);
    assert!(database.inbox_paths().unwrap().is_empty());
    assert_eq!(
        super::support::inbox(
            &database,
            &track,
            super::support::embedded(Some(b"cover snapshot"))
        )
        .unwrap(),
        id
    );
    assert_eq!(database.inbox_paths().unwrap(), vec![path.clone()]);
    assert!(database.library_track_paths().unwrap().is_empty());
    assert!(database
        .list_artists(LibraryGrouping::Artist)
        .unwrap()
        .is_empty());
    assert_eq!(database.get_track(id).unwrap().unwrap().path, path);
    assert_eq!(
        database.get_track_for_playback(id).unwrap().unwrap().path,
        path
    );
    assert!(matches!(
        database.get_track_artwork(id).unwrap(),
        Some(TrackArtwork::Available { .. })
    ));
    assert!(database.get_editing_snapshot(id).is_ok());
    assert_eq!(
        serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap(),
        entries
    );
    assert_eq!(database.list_playlists().unwrap()[0].track_count, 2);
    assert!(database.list_playback_statistics().unwrap().is_empty());
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![id]);
    assert!(database.skipped_tracks().read().unwrap().contains(&id));
    assert_eq!(
        std::fs::read(&file).unwrap(),
        include_bytes!("../../../fixtures/silence.flac")
    );

    super::support::inbox(
        &database,
        &track,
        super::support::embedded(Some(b"cover snapshot")),
    )
    .unwrap();
    track.title = Some("Confirmed".into());
    database
        .update_metadata_cover_and_lyrics(id, &[], None, None, LyricsMarkAction::Keep, Some(&track))
        .unwrap();
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(database.inbox_paths().unwrap(), vec![path.clone()]);
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title.as_deref(),
        Some("Confirmed")
    );
    assert!(matches!(
        database
            .upsert_track(
                &track,
                Some(&crate::database::tests::support::embedded(Some(
                    b"cover snapshot"
                )))
            )
            .unwrap(),
        TrackWriteOutcome::Added
    ));
    assert_eq!(database.get_track(id).unwrap().unwrap().path, path);
    assert_eq!(
        database
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    database.remove_track_from_library(id).unwrap();
    database.delete_playlist(playlist).unwrap();
    drop(database);
    let reopened = Database::open(directory.path().join("tracks.sqlite3")).unwrap();
    assert!(reopened.get_track(id).unwrap().is_some());
    assert!(reopened.list_playback_statistics().unwrap().is_empty());
    assert_eq!(reopened.list_skipped_track_ids().unwrap(), vec![id]);
    assert!(reopened.library_track_paths().unwrap().is_empty());
}

#[test]
fn library_import_rolls_back_snapshot_and_membership_if_inbox_removal_fails() {
    let database = Database::open(":memory:").unwrap();
    let mut track = snapshot("song.flac", None, None);
    let id = register(&database, &track);
    super::support::inbox(
        &database,
        &track,
        super::support::embedded(Some(b"cover snapshot")),
    )
    .unwrap();
    database.connection().unwrap().execute_batch("CREATE TRIGGER reject_inbox_removal BEFORE DELETE ON inbox BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();
    track.title = Some("New snapshot".into());
    assert!(database
        .upsert_track(
            &track,
            Some(&crate::database::tests::support::embedded(Some(
                b"cover snapshot"
            )))
        )
        .is_err());
    assert_eq!(
        database.get_track(id).unwrap().unwrap().title.as_deref(),
        Some("Song")
    );
    assert!(database.library_track_paths().unwrap().is_empty());
    assert_eq!(database.inbox_paths().unwrap(), vec![track.path]);
}

#[test]
fn inbox_registration_rolls_back_if_registration_or_membership_removal_fails() {
    for trigger in [
        "CREATE TRIGGER reject_inbox_registration BEFORE INSERT ON inbox BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
        "CREATE TRIGGER reject_membership_removal BEFORE UPDATE OF in_library ON tracks WHEN NEW.in_library = 0 BEGIN SELECT RAISE(ABORT, 'blocked'); END;",
    ] {
        let database = Database::open(":memory:").unwrap();
        let track = snapshot("song.flac", None, None);
        database.upsert_track(&track, None).unwrap();
        database.connection().unwrap().execute_batch(trigger).unwrap();

        assert!(super::support::inbox(&database, &track, super::support::embedded(Some(b"cover snapshot"))).is_err());
        assert!(database.inbox_paths().unwrap().is_empty());
        assert_eq!(database.library_track_paths().unwrap(), vec![track.path]);
    }
}

#[test]
fn identical_snapshots_at_different_paths_have_independent_track_identities() {
    let database = Database::open(":memory:").unwrap();
    let mut track = snapshot("first.flac", Some("Artist"), Some("Album"));
    let first = register(&database, &track);
    track.path = "copy.flac".into();
    let copy = register(&database, &track);
    assert_ne!(first, copy);
    assert!(!database.record_track_play(first).unwrap());
    database.set_tracks_skipped(&[first], true).unwrap();
    assert!(database.list_playback_statistics().unwrap().is_empty());
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![first]);
    assert_eq!(register(&database, &track), copy);
}

#[test]
fn directory_relocation_updates_external_tracks_without_granting_membership() {
    let database = Database::open(":memory:").unwrap();
    let member = snapshot("/old/member.flac", None, None);
    database
        .upsert_track(
            &member,
            Some(&crate::database::tests::support::embedded(Some(
                b"cover snapshot",
            ))),
        )
        .unwrap();
    let external = register(&database, &snapshot("/old/external.flac", None, None));
    database.set_tracks_skipped(&[external], true).unwrap();
    let playlist = database.create_playlist("Favorites").unwrap();
    database
        .append_playlist_tracks(playlist, vec![external])
        .unwrap();
    assert_eq!(database.remap_paths("/old", "/new").unwrap(), 4);
    assert_eq!(
        database.library_track_paths().unwrap(),
        vec!["/new/member.flac"]
    );
    assert_eq!(
        database.get_track(external).unwrap().unwrap().path,
        "/new/external.flac"
    );
    assert_eq!(database.list_skipped_track_ids().unwrap(), vec![external]);
    assert_eq!(database.list_playlist_tracks(playlist).unwrap().len(), 1);
    let source: String = database
        .connection()
        .unwrap()
        .query_row(
            "SELECT source_path FROM track_artwork_sources s JOIN track_artwork a ON a.id = s.artwork_id WHERE a.track_id = ?1",
            [external],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(source, "/new/external.flac");
}
