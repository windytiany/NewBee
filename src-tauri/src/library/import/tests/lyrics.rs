use super::super::files::run_import;
use crate::fixtures::TestFiles;
use crate::{
    database::Database,
    metadata::{model::LyricsMarkAction, save::save_track},
};
use lofty::{
    config::WriteOptions,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};

#[test]
fn scan_caches_lyrics_preserves_empty_marks_and_clears_marks_when_lyrics_appear() {
    let files = TestFiles::new();
    let path = files.wav("lyrics.wav");
    let database = Database::open(":memory:").unwrap();
    assert_eq!(run_import(&database, std::slice::from_ref(&path)).added, 1);
    assert!(database.get_lyrics(1).unwrap().text.is_none());
    assert!(save_track(&database, 1, &[], LyricsMarkAction::Mark, None).database_updated);
    assert_eq!(
        run_import(&database, std::slice::from_ref(&path)).updated,
        0
    );
    assert!(database.get_lyrics(1).unwrap().no_lyrics);
    let text = "  [00:01.00]Imported lyrics\n\n";
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::UnsyncLyrics, text.into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert_eq!(
        run_import(&database, std::slice::from_ref(&path)).updated,
        1
    );
    let snapshot = database.get_lyrics(1).unwrap();
    assert_eq!(snapshot.text.as_deref(), Some(text));
    assert!(!snapshot.no_lyrics);
    assert_eq!(
        run_import(&database, std::slice::from_ref(&path)).updated,
        0
    );
    std::fs::remove_file(&path).unwrap();
    // Reading the cache and confirmation status must work without the audio file.
    assert_eq!(database.get_lyrics(1).unwrap().text.as_deref(), Some(text));
    let target = serde_json::to_value(database.lyrics_download_targets(&[1]).unwrap()).unwrap();
    assert_eq!(target[0]["hasLyrics"], true);
    assert_eq!(target[0]["noLyrics"], false);
    assert!(target[0].get("text").is_none());
}

#[test]
fn scanning_whitespace_lyrics_records_missing_not_existing_lyrics() {
    let files = TestFiles::new();
    let path = files.wav("empty.wav");
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::UnsyncLyrics, " \n\t ".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let database = Database::open(":memory:").unwrap();
    assert_eq!(run_import(&database, &[path]).added, 1);
    let snapshot = database.get_lyrics(1).unwrap();
    assert!(snapshot.text.is_none() && !snapshot.no_lyrics);
}
