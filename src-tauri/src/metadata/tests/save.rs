use super::support::{change, Fixture};
use crate::{
    database::{model::TrackWriteInput, Database},
    metadata::{
        files,
        model::{LyricsMarkAction, MetadataField},
        save::{save_track, CoverUpdate},
    },
};
use lofty::{file::TaggedFileExt, prelude::*};
use std::fs;

#[test]
fn deleted_cover_and_file_only_fields_sync_or_report_database_failure_and_retry() {
    let fixture = Fixture::new();
    let path = fixture.0.join("track.flac");
    fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let cover = CoverUpdate::new(
        files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap(),
    );
    let database_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    database
        .upsert_track(
            &files::read_track(&path).unwrap().unwrap(),
            Some(&crate::database::tests::support::embedded(
                &files::read_track(&path).unwrap().unwrap(),
            )),
        )
        .unwrap();
    assert!(save_track(&database, 1, &[], LyricsMarkAction::Keep, Some(&cover)).database_updated);
    let connection = rusqlite::Connection::open(&database_path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_delete_cover BEFORE UPDATE OF title ON tracks BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;").unwrap();
    let changes = [
        change(MetadataField::Label, Some("new label")),
        change(MetadataField::OriginalReleaseDate, Some("1998-03")),
    ];
    let delete = CoverUpdate::delete();
    let failed = save_track(
        &database,
        1,
        &changes,
        LyricsMarkAction::Keep,
        Some(&delete),
    );
    assert!(failed.file_written && !failed.database_updated);
    assert!(failed.error.unwrap().contains("数据库同步失败"));
    let file = files::read_track(&path).unwrap().unwrap();
    assert!(file.artwork.is_none());
    assert_eq!(
        file.editing.unwrap().values[&MetadataField::Label],
        "new label"
    );
    assert!(matches!(
        database.get_track_artwork(1).unwrap(),
        Some(crate::artwork::model::TrackArtwork::Available { .. })
    ));
    connection
        .execute_batch("DROP TRIGGER fail_delete_cover")
        .unwrap();
    let saved = save_track(
        &database,
        1,
        &changes,
        LyricsMarkAction::Keep,
        Some(&delete),
    );
    assert!(saved.file_written && saved.database_updated);
    assert!(matches!(
        database.get_track_artwork(1).unwrap(),
        Some(crate::artwork::model::TrackArtwork::NoArtwork)
    ));
    let snapshot = database.get_editing_snapshot(1).unwrap();
    assert_eq!(snapshot.values[&MetadataField::Label], "new label");
    assert_eq!(
        snapshot.values[&MetadataField::OriginalReleaseDate],
        "1998-03"
    );
    assert!(
        save_track(
            &database,
            1,
            &[change(MetadataField::Label, None)],
            LyricsMarkAction::Keep,
            None
        )
        .database_updated
    );
    assert!(!database
        .get_editing_snapshot(1)
        .unwrap()
        .values
        .contains_key(&MetadataField::Label));
}

#[test]
fn writes_selected_fields_and_updates_the_confirmed_database_snapshot() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    files::write_file(
        &path,
        &[
            change(MetadataField::Title, Some("old")),
            change(MetadataField::Artist, Some("artist")),
            change(MetadataField::Album, Some("album")),
            change(MetadataField::AlbumArtist, Some("group")),
        ],
    )
    .unwrap();
    let database = Database::open(":memory:").unwrap();
    database
        .upsert_track(
            &TrackWriteInput {
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
                editing: None,
                lyrics: None,
            },
            None,
        )
        .unwrap();
    let result = save_track(
        &database,
        1,
        &[change(MetadataField::Title, Some("new"))],
        LyricsMarkAction::Keep,
        None,
    );
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
    let result = save_track(
        &database,
        1,
        &[change(MetadataField::Lyrics, Some(lyrics))],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(result.file_written && result.database_updated);
    assert_eq!(
        crate::metadata::files::lyrics::embedded_lyrics_text(
            &lofty::read_from_path(&path).unwrap()
        ),
        Some(lyrics)
    );
    let after = serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap();
    assert_eq!(after, track);
    fs::remove_file(&path).unwrap();
    let result = save_track(
        &database,
        1,
        &[change(MetadataField::Title, Some("failed"))],
        LyricsMarkAction::Keep,
        None,
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
    connection.execute_batch("CREATE TRIGGER fail_metadata_update BEFORE UPDATE OF title ON tracks BEGIN SELECT RAISE(FAIL, 'database unavailable'); END;").unwrap();
    let changes = [change(MetadataField::Title, Some("new"))];
    let result = save_track(&database, 1, &changes, LyricsMarkAction::Keep, None);
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
    let bytes = fs::read(&path).unwrap();
    let retried = save_track(&database, 1, &changes, LyricsMarkAction::Keep, None);
    assert!(retried.file_written && retried.database_updated);
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "new"
    );
}

#[test]
fn saves_cover_only_and_preserves_it_when_later_changes_fail_and_retry() {
    let fixture = Fixture::new();
    let path = fixture.0.join("track.flac");
    fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    files::write_file(&path, &[change(MetadataField::Title, Some("old"))]).unwrap();
    let database_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    let connection = rusqlite::Connection::open(&database_path).unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path, title) VALUES (?1, 'old')",
            [path.to_string_lossy().as_ref()],
        )
        .unwrap();
    let bytes = include_bytes!("../../../fixtures/cover.png");
    let cover = CoverUpdate::new(files::cover_picture(bytes).unwrap());
    let result = save_track(&database, 1, &[], LyricsMarkAction::Keep, Some(&cover));
    assert!(
        result.file_written && result.database_updated,
        "{:?}",
        result.error
    );
    let artwork = serde_json::to_value(database.get_track_artwork(1).unwrap()).unwrap();
    assert_eq!(artwork["mimeType"], "image/png");
    assert_eq!(
        artwork["data"],
        serde_json::to_value(bytes.as_slice()).unwrap()
    );
    let file = lofty::read_from_path(&path).unwrap();
    assert_eq!(file.primary_tag().unwrap().pictures()[0].data(), bytes);
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "old"
    );

    connection.execute_batch("CREATE TRIGGER fail_metadata_update BEFORE UPDATE OF title ON tracks BEGIN SELECT RAISE(FAIL, 'unavailable'); END;").unwrap();
    let changes = [change(MetadataField::Title, Some("new"))];
    let failed = save_track(&database, 1, &changes, LyricsMarkAction::Keep, None);
    assert!(failed.file_written && !failed.database_updated);
    assert!(failed.error.unwrap().contains("数据库同步失败"));
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
        .execute_batch("DROP TRIGGER fail_metadata_update")
        .unwrap();
    let retry = save_track(&database, 1, &changes, LyricsMarkAction::Keep, None);
    assert!(retry.file_written && retry.database_updated);
    assert_eq!(
        serde_json::to_value(database.get_track_artwork(1).unwrap()).unwrap(),
        artwork
    );
    assert_eq!(
        lofty::read_from_path(&path)
            .unwrap()
            .primary_tag()
            .unwrap()
            .pictures()[0]
            .data(),
        bytes
    );
}

#[test]
fn cover_database_failure_rolls_back_metadata_and_retry_repairs_both() {
    let fixture = Fixture::new();
    let path = fixture.0.join("track.flac");
    fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let database_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    let connection = rusqlite::Connection::open(&database_path).unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path, title) VALUES (?1, 'old')",
            [path.to_string_lossy().as_ref()],
        )
        .unwrap();
    connection.execute_batch("CREATE TRIGGER fail_cover BEFORE INSERT ON track_artwork BEGIN SELECT RAISE(FAIL, 'cover unavailable'); END;").unwrap();
    let bytes = include_bytes!("../../../fixtures/cover.png");
    let cover = CoverUpdate::new(files::cover_picture(bytes).unwrap());
    let changes = [change(MetadataField::Title, Some("new"))];
    let failed = save_track(&database, 1, &changes, LyricsMarkAction::Keep, Some(&cover));
    assert!(failed.file_written && !failed.database_updated);
    let error = failed.error.unwrap();
    assert!(error.contains("文件已写入") && error.contains("cover unavailable"));
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "old"
    );
    assert!(matches!(
        database.get_track_artwork(1).unwrap(),
        Some(crate::artwork::model::TrackArtwork::NoArtwork)
    ));
    let file = lofty::read_from_path(&path).unwrap();
    assert_eq!(file.primary_tag().unwrap().title().as_deref(), Some("new"));
    assert_eq!(file.primary_tag().unwrap().pictures()[0].data(), bytes);
    connection.execute_batch("DROP TRIGGER fail_cover").unwrap();
    let retried = save_track(&database, 1, &changes, LyricsMarkAction::Keep, Some(&cover));
    assert!(retried.file_written && retried.database_updated);
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "new"
    );
    assert_eq!(
        serde_json::to_value(database.get_track_artwork(1).unwrap()).unwrap()["mimeType"],
        "image/png"
    );
}

#[test]
fn failed_file_write_with_cover_does_not_update_database() {
    let fixture = Fixture::new();
    let path = fixture.0.join("missing.flac");
    let database_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&database_path).unwrap();
    let connection = rusqlite::Connection::open(&database_path).unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path, title) VALUES (?1, 'old')",
            [path.to_string_lossy().as_ref()],
        )
        .unwrap();
    let cover = CoverUpdate::new(
        files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap(),
    );
    let result = save_track(
        &database,
        1,
        &[change(MetadataField::Title, Some("new"))],
        LyricsMarkAction::Keep,
        Some(&cover),
    );
    assert!(!result.file_written && !result.database_updated);
    assert_eq!(result.path, path.to_string_lossy());
    assert!(result.error.is_some());
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap()["title"],
        "old"
    );
    assert!(matches!(
        database.get_track_artwork(1).unwrap(),
        Some(crate::artwork::model::TrackArtwork::NoArtwork)
    ));
}

#[test]
fn missing_track_reports_id_without_attempting_persistence() {
    let database = Database::open(":memory:").unwrap();
    let result = save_track(&database, 42, &[], LyricsMarkAction::Mark, None);
    assert_eq!(result.track_id, 42);
    assert!(result.path.is_empty());
    assert!(!result.file_written && !result.database_updated);
    assert_eq!(result.error.as_deref(), Some("曲目 42 已不在数据库中"));
}
