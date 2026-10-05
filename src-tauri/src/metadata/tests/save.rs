use super::support::{change, Fixture};
use crate::{
    database::{Database, TrackWriteInput},
    metadata::{files, model::MetadataField, save_track},
};
use lofty::{file::TaggedFileExt, prelude::*};
use std::fs;

#[test]
fn writes_file_before_updating_only_requested_database_fields() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let database = Database::open(":memory:").unwrap();
    database
        .upsert_track(&TrackWriteInput {
            path: path.to_string_lossy().into_owned(),
            title: Some("old".into()),
            artist: Some("artist".into()),
            album: Some("album".into()),
            album_artist: Some("group".into()),
            release_date: None,
            disc_number: None,
            track_number: None,
            disc_total: None,
            track_total: None,
            duration_ms: Some(1000),
            codec: None,
            sample_rate_hz: Some(8000),
            bitrate_kbps: None,
            channels: Some(1),
            artwork: None,
            lyrics: None,
        })
        .unwrap();
    let result = save_track(&database, 1, &[change(MetadataField::Title, Some("new"))]);
    assert!(result.file_written && result.database_updated);
    let track = serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap();
    assert_eq!(track["title"], "new");
    assert_eq!(track["artist"], "artist");
    assert_eq!(track["durationMs"], 1000);
    files::write_file(
        &path,
        &[change(MetadataField::Lyrics, Some("Existing lyrics"))],
    )
    .unwrap();
    let lyrics = "[00:01.00]New lyrics\n";
    let result = save_track(&database, 1, &[change(MetadataField::Lyrics, Some(lyrics))]);
    assert!(result.file_written && result.database_updated);
    assert_eq!(
        crate::lyrics::local::embedded_lyrics_text(&lofty::read_from_path(&path).unwrap()),
        Some(lyrics)
    );
    let after = serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap();
    assert_eq!(after, track);
    fs::remove_file(&path).unwrap();
    let result = save_track(
        &database,
        1,
        &[change(MetadataField::Title, Some("failed"))],
    );
    assert!(!result.file_written && !result.database_updated);
    let track = serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap();
    assert_eq!(track["title"], "new");
}

#[test]
fn reports_database_failure_after_file_write_and_allows_resaving() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let database_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    let connection = rusqlite::Connection::open(&database_path).unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path, title) VALUES (?1, 'old')",
            [path.to_string_lossy().as_ref()],
        )
        .unwrap();
    connection.execute_batch("CREATE TRIGGER fail_metadata_update BEFORE UPDATE ON tracks BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;").unwrap();
    let changes = [change(MetadataField::Title, Some("new"))];
    let result = save_track(&database, 1, &changes);
    assert!(result.file_written);
    assert!(!result.database_updated);
    assert!(result.error.unwrap().contains("数据库同步失败"));
    assert_eq!(
        lofty::read_from_path(&path)
            .unwrap()
            .primary_tag()
            .unwrap()
            .title()
            .as_deref(),
        Some("new")
    );
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "old"
    );
    connection
        .execute_batch("DROP TRIGGER fail_metadata_update;")
        .unwrap();
    let retried = save_track(&database, 1, &changes);
    assert!(retried.file_written && retried.database_updated);
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "new"
    );
}
