use super::support::{change, Fixture};
use crate::{
    database::Database,
    lyrics::local::embedded_lyrics_text,
    metadata::{
        files,
        model::{LyricsMarkAction, MetadataField},
        save::save_track,
    },
};
use lofty::{
    config::WriteOptions,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::{fs, path::Path};

fn library(fixture: &Fixture, path: &Path, lyrics: Option<&str>) -> Database {
    let db_path = fixture.0.join("library.sqlite3");
    let database = Database::open(&db_path).unwrap();
    let connection = rusqlite::Connection::open(db_path).unwrap();
    connection
        .execute(
            "INSERT INTO tracks (path) VALUES (?1)",
            [path.to_string_lossy().as_ref()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO track_lyrics (track_id, text) VALUES (1, ?1)",
            [lyrics],
        )
        .unwrap();
    database
}
fn mp3(fixture: &Fixture, lyrics: Option<&str>) -> std::path::PathBuf {
    let path = fixture.0.join("track.mp3");
    fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::TrackTitle, "Preserved title".into());
    if let Some(lyrics) = lyrics {
        tag.insert_text(ItemKey::UnsyncLyrics, lyrics.into());
    }
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    path
}

#[test]
fn marking_deletes_file_lyrics_and_unmarking_does_not_restore_them() {
    let fixture = Fixture::new();
    let path = mp3(&fixture, Some("[00:01.00]Old lyrics"));
    let database = library(&fixture, &path, Some("[00:01.00]Old lyrics"));
    let result = save_track(&database, 1, &[], LyricsMarkAction::Mark, None);
    assert!(
        result.file_written && result.database_updated,
        "{:?}",
        result.error
    );
    let snapshot = database.get_lyrics(1).unwrap();
    assert!(snapshot.text.is_none() && snapshot.no_lyrics);
    let file = lofty::read_from_path(&path).unwrap();
    assert!(embedded_lyrics_text(&file).is_none());
    assert_eq!(
        file.primary_tag().unwrap().title().as_deref(),
        Some("Preserved title")
    );
    let bytes = fs::read(&path).unwrap();
    let result = save_track(&database, 1, &[], LyricsMarkAction::Unmark, None);
    assert!(!result.file_written && result.database_updated);
    assert!(!database.get_lyrics(1).unwrap().no_lyrics);
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn file_write_failure_leaves_both_lyrics_and_mark_unchanged() {
    let fixture = Fixture::new();
    let path = mp3(&fixture, Some("Old lyrics"));
    let database = library(&fixture, &path, Some("Old lyrics"));
    fs::remove_file(&path).unwrap();
    let result = save_track(&database, 1, &[], LyricsMarkAction::Mark, None);
    assert!(!result.file_written && !result.database_updated);
    let snapshot = database.get_lyrics(1).unwrap();
    assert_eq!(snapshot.text.as_deref(), Some("Old lyrics"));
    assert!(!snapshot.no_lyrics);
}

#[test]
fn missing_files_block_marking_but_not_unmarking() {
    let fixture = Fixture::new();
    let path = fixture.0.join("missing.mp3");
    let database = library(&fixture, &path, None);
    let marked = save_track(&database, 1, &[], LyricsMarkAction::Mark, None);
    assert!(!marked.file_written && !marked.database_updated);
    assert!(!database.get_lyrics(1).unwrap().no_lyrics);
    let unmarked = save_track(&database, 1, &[], LyricsMarkAction::Unmark, None);
    assert!(!unmarked.file_written && unmarked.database_updated);
}

#[test]
fn marking_clears_file_lyrics_even_when_the_database_has_no_cached_lyrics() {
    let fixture = Fixture::new();
    let path = mp3(&fixture, Some("Uncached file lyrics"));
    let database = library(&fixture, &path, None);
    let marked = save_track(&database, 1, &[], LyricsMarkAction::Mark, None);
    assert!(marked.file_written && marked.database_updated);
    assert!(embedded_lyrics_text(&lofty::read_from_path(&path).unwrap()).is_none());
    assert!(database.get_lyrics(1).unwrap().no_lyrics);
}

#[test]
fn database_only_unmark_failure_preserves_snapshot_and_allows_retry() {
    let fixture = Fixture::new();
    let path = fixture.0.join("missing.mp3");
    let database = library(&fixture, &path, None);
    let connection = rusqlite::Connection::open(fixture.0.join("library.sqlite3")).unwrap();
    connection
        .execute("UPDATE track_lyrics SET no_lyrics = 1", [])
        .unwrap();
    connection.execute_batch("CREATE TRIGGER fail_lyrics BEFORE UPDATE ON track_lyrics BEGIN SELECT RAISE(FAIL, 'mark unavailable'); END;").unwrap();
    let failed = save_track(&database, 1, &[], LyricsMarkAction::Unmark, None);
    assert!(!failed.file_written && !failed.database_updated);
    let error = failed.error.unwrap();
    assert!(error.starts_with("数据库更新失败：") && error.contains("mark unavailable"));
    assert!(database.get_lyrics(1).unwrap().no_lyrics);
    connection
        .execute_batch("DROP TRIGGER fail_lyrics")
        .unwrap();
    let retried = save_track(&database, 1, &[], LyricsMarkAction::Unmark, None);
    assert!(!retried.file_written && retried.database_updated);
    assert!(!database.get_lyrics(1).unwrap().no_lyrics);
    assert!(!path.exists());
}

#[test]
fn saving_nonempty_lyrics_clears_the_mark_and_caches_original_text() {
    let fixture = Fixture::new();
    let path = mp3(&fixture, None);
    let database = library(&fixture, &path, None);
    assert!(save_track(&database, 1, &[], LyricsMarkAction::Mark, None).database_updated);
    let text = "  [00:01.00]New lyrics\n\n";
    let result = save_track(
        &database,
        1,
        &[change(MetadataField::Lyrics, Some(text))],
        LyricsMarkAction::Keep,
        None,
    );
    assert!(
        result.file_written && result.database_updated,
        "{:?}",
        result.error
    );
    let snapshot = database.get_lyrics(1).unwrap();
    assert_eq!(snapshot.text.as_deref(), Some(text));
    assert!(!snapshot.no_lyrics);
}

#[test]
fn database_failure_after_clearing_file_is_reported_and_retry_repairs_snapshot() {
    let fixture = Fixture::new();
    let path = mp3(&fixture, Some("Old lyrics"));
    let database = library(&fixture, &path, Some("Old lyrics"));
    let connection = rusqlite::Connection::open(fixture.0.join("library.sqlite3")).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_lyrics BEFORE UPDATE ON track_lyrics BEGIN SELECT RAISE(FAIL, 'unavailable'); END;").unwrap();
    let result = save_track(&database, 1, &[], LyricsMarkAction::Mark, None);
    assert!(result.file_written && !result.database_updated);
    assert!(result.error.unwrap().contains("数据库同步失败"));
    let snapshot = database.get_lyrics(1).unwrap();
    assert_eq!(snapshot.text.as_deref(), Some("Old lyrics"));
    assert!(!snapshot.no_lyrics);
    assert!(embedded_lyrics_text(&lofty::read_from_path(&path).unwrap()).is_none());
    connection
        .execute_batch("DROP TRIGGER fail_lyrics;")
        .unwrap();
    assert!(save_track(&database, 1, &[], LyricsMarkAction::Mark, None).database_updated);
    assert!(database.get_lyrics(1).unwrap().no_lyrics);
}

#[test]
fn replacement_and_clearing_remove_secondary_lyrics_without_dropping_other_fields() {
    let fixture = Fixture::new();
    let path = mp3(&fixture, Some("Primary lyrics"));
    let mut secondary = Tag::new(TagType::Ape);
    secondary.insert_text(ItemKey::Lyrics, "[00:01.00]Secondary lyrics".into());
    secondary.insert_text(ItemKey::Comment, "Keep comment".into());
    secondary
        .save_to_path(&path, WriteOptions::default())
        .unwrap();
    files::write_file(
        &path,
        &[change(MetadataField::Lyrics, Some("New plain lyrics"))],
    )
    .unwrap();
    let file = lofty::read_from_path(&path).unwrap();
    assert_eq!(embedded_lyrics_text(&file), Some("New plain lyrics"));
    assert_eq!(
        file.tag(TagType::Ape).unwrap().get_string(ItemKey::Comment),
        Some("Keep comment")
    );
    assert!(file
        .tag(TagType::Ape)
        .unwrap()
        .get_string(ItemKey::Lyrics)
        .is_none());
    files::write_file(&path, &[change(MetadataField::Lyrics, None)]).unwrap();
    assert!(embedded_lyrics_text(&lofty::read_from_path(&path).unwrap()).is_none());
}
