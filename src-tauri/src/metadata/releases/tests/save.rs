use super::*;
use crate::database::TrackWriteInput;
use lofty::{file::TaggedFileExt, prelude::Accessor};
use std::{fs, path::PathBuf};
struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn input(path: &Path) -> TrackWriteInput {
    TrackWriteInput {
        path: path.to_string_lossy().into(),
        title: Some("old".into()),
        artist: Some("keep".into()),
        album: Some("album".into()),
        album_artist: Some("artist".into()),
        release_date: None,
        disc_number: None,
        track_number: None,
        disc_total: None,
        track_total: None,
        duration_ms: Some(1000),
        codec: Some("FLAC".into()),
        sample_rate_hz: None,
        bitrate_kbps: None,
        channels: None,
        artwork: None,
        lyrics: None,
    }
}
#[test]
fn saves_independent_patches_and_cover_then_retries_database_failure() {
    let fixture =
        Fixture(std::env::temp_dir().join(format!("newbee-album-save-{}", std::process::id())));
    fs::create_dir_all(&fixture.0).unwrap();
    let path = fixture.0.join("track.flac");
    fs::write(&path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let db_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&db_path).unwrap();
    database.upsert_track(&input(&path)).unwrap();
    database
        .upsert_track(&input(&fixture.0.join("missing.flac")))
        .unwrap();
    let picture = files::cover_picture(include_bytes!("../../../../fixtures/cover.png")).unwrap();
    let artwork = EmbeddedArtwork {
        mime_type: "image/png".into(),
        image: picture.data().to_vec(),
    };
    let patches: Vec<_> = [1, 2]
        .into_iter()
        .map(|track_id| TrackPatch {
            track_id,
            changes: vec![MetadataChange {
                field: MetadataField::Title,
                value: Some(format!("new {track_id}")),
            }],
            write_cover: true,
        })
        .collect();
    let results: Vec<_> = patches
        .iter()
        .map(|patch| save_patch(&database, patch, Some(&picture), Some(&artwork)))
        .collect();
    assert!(results[0].file_written && results[0].database_updated);
    assert!(!results[1].file_written && !results[1].database_updated);
    let first = serde_json::to_value(database.get_track(1).unwrap()).unwrap();
    assert_eq!(first["title"], "new 1");
    assert_eq!(first["artist"], "keep");
    assert_eq!(first["durationMs"], 1000);
    let second = serde_json::to_value(database.get_track(2).unwrap()).unwrap();
    assert_eq!(second["title"], "old");
    let saved_cover = serde_json::to_value(database.get_track_artwork(1).unwrap()).unwrap();
    assert_eq!(saved_cover["mimeType"], "image/png");
    assert_eq!(
        saved_cover["data"],
        serde_json::to_value(&artwork.image).unwrap()
    );
    let connection = rusqlite::Connection::open(&db_path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_update BEFORE UPDATE ON tracks BEGIN SELECT RAISE(FAIL, 'unavailable'); END;").unwrap();
    let patch = TrackPatch {
        track_id: 1,
        changes: vec![MetadataChange {
            field: MetadataField::Title,
            value: Some("retry title".into()),
        }],
        write_cover: false,
    };
    let failed = save_patch(&database, &patch, None, None);
    assert!(failed.file_written && !failed.database_updated);
    assert_eq!(
        lofty::read_from_path(&path)
            .unwrap()
            .primary_tag()
            .unwrap()
            .title()
            .as_deref(),
        Some("retry title")
    );
    assert_eq!(
        serde_json::to_value(database.get_track(1).unwrap()).unwrap()["title"],
        "new 1"
    );
    connection
        .execute_batch("DROP TRIGGER fail_update")
        .unwrap();
    let retry = save_patch(&database, &patch, None, None);
    assert!(retry.file_written && retry.database_updated);
    assert_eq!(
        serde_json::to_value(database.get_track_artwork(1).unwrap()).unwrap(),
        saved_cover
    );
}

#[test]
fn rejects_duplicate_targets_and_missing_cover() {
    let patch = || TrackPatch {
        track_id: 1,
        changes: vec![],
        write_cover: true,
    };
    assert!(validate_patches(&mut [patch()], None).is_err());
    let cover = CoverData {
        mime_type: "image/png".into(),
        data: vec![],
    };
    assert!(validate_patches(&mut [patch(), patch()], Some(&cover)).is_err());
    assert!(validate_patches(&mut [patch()], Some(&cover)).is_ok());
}
