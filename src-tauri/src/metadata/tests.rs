use super::{
    files,
    model::{normalize_changes, MetadataChange, MetadataField},
    save_track,
};
use crate::database::{Database, TrackWriteInput};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

#[path = "cover_tests.rs"]
mod cover_tests;

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "newbee-metadata-test-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn wav(&self) -> PathBuf {
        let path = self.0.join("track.wav");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&8036u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&[128; 8000]);
        fs::write(&path, bytes).unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap()
    }
}
fn change(field: MetadataField, value: Option<&str>) -> MetadataChange {
    MetadataChange {
        field,
        value: value.map(str::to_owned),
    }
}

#[test]
fn validates_dates_numbers_and_explicit_clearing() {
    for date in ["2024", "2024-02", "2024-02-29"] {
        assert!(normalize_changes(&mut [change(MetadataField::ReleaseDate, Some(date))]).is_ok());
    }
    for date in [
        "2023-02-29",
        "2024-13",
        "0000",
        "2024-2",
        "2024-04-31",
        "２０２４",
    ] {
        assert!(normalize_changes(&mut [change(MetadataField::ReleaseDate, Some(date))]).is_err());
    }
    for number in ["0", "-1", "1.5", "4294967296"] {
        assert!(
            normalize_changes(&mut [change(MetadataField::TrackNumber, Some(number))]).is_err()
        );
    }
    let mut changes = [
        change(MetadataField::Title, Some("  ")),
        change(MetadataField::TrackNumber, Some(" 002 ")),
    ];
    normalize_changes(&mut changes).unwrap();
    assert!(changes[0].value.is_none());
    assert_eq!(changes[1].value.as_deref(), Some("2"));
    assert!(normalize_changes(&mut [
        change(MetadataField::Title, None),
        change(MetadataField::Title, Some("x"))
    ])
    .is_err());
}

#[test]
fn safe_write_preserves_other_tags_custom_fields_totals_and_audio() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut riff = Tag::new(TagType::RiffInfo);
    riff.insert_text(ItemKey::TrackTitle, "secondary title".into());
    riff.save_to_path(&path, WriteOptions::default()).unwrap();
    let mut primary = Tag::new(TagType::Id3v2);
    primary.insert_text(ItemKey::TrackTitle, "file title".into());
    primary.insert_text(ItemKey::Comment, "keep comment".into());
    primary.insert_text(ItemKey::RecordingDate, "2020-02-01".into());
    primary.set_track_total(12);
    primary
        .save_to_path(&path, WriteOptions::default())
        .unwrap();
    let changes = [
        change(MetadataField::Title, Some("database title")),
        change(MetadataField::ReleaseDate, None),
        change(MetadataField::TrackNumber, Some("2")),
    ];
    files::write_file(&path, &changes).unwrap();
    let file = lofty::read_from_path(&path).unwrap();
    let tag = file.primary_tag().unwrap();
    assert_eq!(tag.title().as_deref(), Some("database title"));
    assert_eq!(tag.get_string(&ItemKey::Comment), Some("keep comment"));
    assert_eq!(tag.track_total(), Some(12));
    assert!(tag.get_string(&ItemKey::RecordingDate).is_none());
    assert_eq!(
        file.tag(TagType::RiffInfo).unwrap().title().as_deref(),
        Some("secondary title")
    );
    let bytes = fs::read(&path).unwrap();
    let audio_start = bytes.windows(4).position(|chunk| chunk == b"data").unwrap() + 8;
    assert_eq!(&bytes[audio_start..audio_start + 8000], &[128; 8000]);
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn failed_validation_never_changes_file() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_track_total(2);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(files::write_file(&path, &[change(MetadataField::TrackNumber, Some("3"))]).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

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
        })
        .unwrap();
    let result = save_track(&database, 1, &[change(MetadataField::Title, Some("new"))]);
    assert!(result.file_written && result.database_updated);
    let track = serde_json::to_value(database.get_track(1).unwrap().unwrap()).unwrap();
    assert_eq!(track["title"], "new");
    assert_eq!(track["artist"], "artist");
    assert_eq!(track["durationMs"], 1000);
    let lyrics = "[00:01.00]New lyrics\n";
    let result = save_track(&database, 1, &[change(MetadataField::Lyrics, Some(lyrics))]);
    assert!(result.file_written && result.database_updated);
    assert_eq!(
        files::inspect_file(&path).unwrap().lyrics.as_deref(),
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
fn supported_formats_round_trip_all_exposed_fields() {
    let fixtures: &[(&str, &[u8])] = &[
        ("mp3", include_bytes!("fixtures/silence.mp3")),
        ("aac", include_bytes!("fixtures/silence.aac")),
        ("m4a", include_bytes!("fixtures/silence.m4a")),
        ("ogg", include_bytes!("fixtures/silence.ogg")),
        ("oga", include_bytes!("fixtures/silence.ogg")),
        ("flac", include_bytes!("fixtures/silence.flac")),
    ];
    let fixture = Fixture::new();
    for (extension, bytes) in fixtures {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        let writable = files::inspect_file(&path).unwrap();
        assert_eq!(writable.writable_fields.len(), 10, "{extension}");
        let changes = [
            change(MetadataField::Title, Some("测试标题")),
            change(MetadataField::Artist, Some("A & B")),
            change(MetadataField::Album, Some("New album")),
            change(MetadataField::AlbumArtist, Some("Single artist")),
            change(MetadataField::ReleaseDate, Some("2024-02-29")),
            change(MetadataField::TrackNumber, Some("2")),
            change(MetadataField::DiscNumber, Some("1")),
            change(MetadataField::TrackTotal, Some("7")),
            change(MetadataField::DiscTotal, Some("2")),
            change(
                MetadataField::Lyrics,
                Some("  [00:01.00]歌词\n[00:02.00]Second line\n\n"),
            ),
        ];
        files::write_file(&path, &changes).unwrap_or_else(|error| panic!("{extension}: {error}"));
        let file = lofty::probe::Probe::open(&path)
            .unwrap()
            .guess_file_type()
            .unwrap()
            .read()
            .unwrap();
        let tag = file.primary_tag().unwrap();
        assert_eq!(tag.title().as_deref(), Some("测试标题"));
        assert_eq!(tag.artist().as_deref(), Some("A & B"));
        assert_eq!(tag.track(), Some(2));
        assert_eq!(tag.track_total(), Some(7));
        assert_eq!(tag.disk_total(), Some(2));
        assert_eq!(
            files::inspect_file(&path).unwrap().lyrics.as_deref(),
            Some("  [00:01.00]歌词\n[00:02.00]Second line\n\n")
        );
        let clear: Vec<_> = MetadataField::ALL
            .into_iter()
            .map(|field| change(field, None))
            .collect();
        files::write_file(&path, &clear)
            .unwrap_or_else(|error| panic!("{extension} clear: {error}"));
        assert!(
            files::inspect_file(&path).unwrap().lyrics.is_none(),
            "{extension}"
        );
    }
}

#[test]
fn id3v1_fallback_exposes_only_representable_fields() {
    let fixture = Fixture::new();
    let path = fixture.0.join("fallback.mp3");
    fs::write(&path, include_bytes!("fixtures/silence.mp3")).unwrap();
    TagType::Id3v2.remove_from_path(&path).unwrap();
    let mut tag = Tag::new(TagType::Id3v1);
    tag.insert_text(ItemKey::TrackTitle, "legacy".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let writable = files::inspect_file(&path).unwrap().writable_fields;
    assert!(writable.contains(&MetadataField::Title));
    assert!(!writable.contains(&MetadataField::AlbumArtist));
    assert!(!writable.contains(&MetadataField::DiscNumber));
    assert!(!writable.contains(&MetadataField::ReleaseDate));
    let before = fs::read(&path).unwrap();
    assert!(files::write_file(&path, &[change(MetadataField::Title, Some("标题"))]).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn clears_numbering_without_dropping_existing_totals() {
    let fixture = Fixture::new();
    let path = fixture.0.join("totals.m4a");
    fs::write(&path, include_bytes!("fixtures/silence.m4a")).unwrap();
    let mut tag = lofty::read_from_path(&path)
        .unwrap()
        .primary_tag()
        .unwrap()
        .clone();
    tag.set_track(2);
    tag.set_track_total(12);
    tag.set_disk(1);
    tag.set_disk_total(2);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(
        &path,
        &[
            change(MetadataField::TrackNumber, None),
            change(MetadataField::DiscNumber, None),
        ],
    )
    .unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    let tag = written.primary_tag().unwrap();
    assert_eq!(tag.track_total(), Some(12));
    assert_eq!(tag.disk_total(), Some(2));
    assert!(tag.track().is_none());
    assert!(tag.disk().is_none());
}

#[test]
fn preserves_all_embedded_pictures_and_unedited_lyrics() {
    use lofty::picture::{MimeType, Picture, PictureType};
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::Lyrics, "untouched lyrics".to_owned());
    for picture_type in [PictureType::CoverFront, PictureType::CoverBack] {
        tag.push_picture(Picture::new_unchecked(
            picture_type,
            Some(MimeType::Png),
            None,
            include_bytes!("fixtures/cover.png").to_vec(),
        ));
    }
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(&path, &[change(MetadataField::Title, Some("new title"))]).unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    let tag = written.primary_tag().unwrap();
    assert_eq!(tag.pictures().len(), 2);
    assert_eq!(
        tag.pictures()[0].data(),
        include_bytes!("fixtures/cover.png")
    );
    assert_eq!(tag.get_string(&ItemKey::Lyrics), Some("untouched lyrics"));
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

#[test]
fn edits_both_halves_of_number_pairs_and_validates_the_result() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.set_track(2);
    tag.set_track_total(3);
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(
        &path,
        &[
            change(MetadataField::TrackNumber, Some("6")),
            change(MetadataField::TrackTotal, Some("7")),
        ],
    )
    .unwrap();
    let updated = lofty::read_from_path(&path).unwrap();
    assert_eq!(updated.primary_tag().unwrap().track(), Some(6));
    assert_eq!(updated.primary_tag().unwrap().track_total(), Some(7));
    let before = fs::read(&path).unwrap();
    assert!(files::write_file(&path, &[change(MetadataField::TrackTotal, Some("4"))]).is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    files::write_file(&path, &[change(MetadataField::TrackTotal, None)]).unwrap();
    assert!(lofty::read_from_path(&path)
        .unwrap()
        .primary_tag()
        .unwrap()
        .track_total()
        .is_none());
}

#[test]
fn read_only_files_are_not_modified() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let original_permissions = fs::metadata(&path).unwrap().permissions();
    let mut read_only = original_permissions.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&path, read_only).unwrap();
    let inspect = files::inspect_file(&path);
    let write = files::write_file(&path, &[change(MetadataField::Title, Some("new"))]);
    fs::set_permissions(&path, original_permissions).unwrap();
    let inspected = inspect.unwrap();
    assert!(inspected.writable_fields.is_empty());
    assert_eq!(inspected.issue.as_deref(), Some("文件为只读"));
    assert!(write.is_err());
    assert!(lofty::read_from_path(&path)
        .unwrap()
        .primary_tag()
        .is_none());
}
