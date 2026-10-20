use super::preservation::flac_audio;
use crate::metadata::{
    files,
    model::{normalize_changes, MetadataField},
    tests::support::{change, long_aac_audio, Fixture},
};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::{fs, path::PathBuf};

#[test]
#[ignore = "requires NEWBEE_LYRICS_REPRO_FILE pointing to a local audio file"]
fn editor_save_preserves_local_file_audio_and_writes_all_requested_fields() {
    let source = PathBuf::from(std::env::var_os("NEWBEE_LYRICS_REPRO_FILE").unwrap());
    let original = fs::read(&source).unwrap();
    let fixture = Fixture::new();
    let path = fixture.0.join(source.file_name().unwrap());
    fs::copy(&source, &path).unwrap();
    let before = lofty::read_from_path(&path).unwrap();
    let tag = before.primary_tag().unwrap();
    let writable = files::inspect_file(&path).unwrap().writable_fields;
    let mut changes = MetadataField::ALL
        .into_iter()
        .filter(|field| writable.contains(field))
        .map(|field| {
            let value = if field == MetadataField::Lyrics {
                Some("downloaded lyrics")
            } else if field == MetadataField::ReleaseDate {
                tag.get_string(field.key(tag.tag_type()))
                    .or_else(|| tag.get_string(ItemKey::RecordingDate))
            } else {
                tag.get_string(field.key(tag.tag_type()))
            };
            change(field, value)
        })
        .collect::<Vec<_>>();
    normalize_changes(&mut changes).unwrap();
    let result = files::write_file(&path, &changes);
    assert_eq!(fs::read(&source).unwrap(), original);
    assert!(result.is_ok(), "{result:?}");
    let written = lofty::read_from_path(&path).unwrap();
    let after = written.primary_tag().unwrap();
    for change in &changes {
        assert_eq!(
            after.get_string(change.field.key(after.tag_type())),
            change.value.as_deref(),
            "{:?}",
            change.field
        );
    }
    assert_eq!(tag.pictures(), after.pictures());
    let bytes = fs::read(&path).unwrap();
    if original.starts_with(b"fLaC") {
        assert_eq!(flac_audio(&bytes), flac_audio(&original));
    }
}

#[test]
fn failed_round_trip_discards_the_copy_and_keeps_original_bytes() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let before = fs::read(&path).unwrap();
    // Inject a value the ID3 serializer reads back as multiple values. Command
    // validation rejects NULs; this exercises the final transactional safeguard.
    let error = files::write_file(
        &path,
        &[change(MetadataField::Title, Some("first\0second"))],
    )
    .unwrap_err();
    assert!(error.contains("字段 Title 写入后回读不一致"), "{error}");
    assert_eq!(fs::read(&path).unwrap(), before);
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
fn supported_formats_round_trip_all_exposed_fields() {
    let aac = long_aac_audio();
    let fixtures: &[(&str, &[u8])] = &[
        ("mp3", include_bytes!("../../../../fixtures/silence.mp3")),
        ("aac", aac.as_slice()),
        ("m4a", include_bytes!("../../../../fixtures/silence.m4a")),
        ("ogg", include_bytes!("../../../../fixtures/silence.ogg")),
        ("oga", include_bytes!("../../../../fixtures/silence.ogg")),
        ("flac", include_bytes!("../../../../fixtures/silence.flac")),
    ];
    let fixture = Fixture::new();
    for (extension, bytes) in fixtures {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        let writable = files::inspect_file(&path).unwrap();
        assert_eq!(
            writable.writable_fields.len(),
            MetadataField::ALL.len(),
            "{extension}"
        );
        let changes = [
            change(MetadataField::Title, Some("测试标题")),
            change(MetadataField::Artist, Some("A & B")),
            change(MetadataField::Album, Some("New album")),
            change(MetadataField::AlbumArtist, Some("Single artist")),
            change(MetadataField::ArtistSort, Some("Artist, The")),
            change(MetadataField::AlbumArtistSort, Some("Album Artist, The")),
            change(MetadataField::DiscSubtitle, Some("碟片标题")),
            change(MetadataField::Label, Some("厂牌")),
            change(MetadataField::OriginalReleaseDate, Some("1998-03-14")),
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
        for update in &changes {
            assert_eq!(
                tag.get_string(update.field.key(tag.tag_type())),
                update.value.as_deref(),
                "{extension}: {:?}",
                update.field
            );
        }
        assert_eq!(tag.title().as_deref(), Some("测试标题"));
        assert_eq!(tag.artist().as_deref(), Some("A & B"));
        assert_eq!(tag.track(), Some(2));
        assert_eq!(tag.track_total(), Some(7));
        assert_eq!(tag.disk_total(), Some(2));
        assert_eq!(
            crate::metadata::files::lyrics::embedded_lyrics_text(&file),
            Some("  [00:01.00]歌词\n[00:02.00]Second line\n\n")
        );
        let clear: Vec<_> = MetadataField::ALL
            .into_iter()
            .map(|field| change(field, None))
            .collect();
        files::write_file(&path, &clear)
            .unwrap_or_else(|error| panic!("{extension} clear: {error}"));
        assert!(
            crate::metadata::files::lyrics::embedded_lyrics_text(
                &lofty::probe::Probe::open(&path)
                    .unwrap()
                    .guess_file_type()
                    .unwrap()
                    .read()
                    .unwrap()
            )
            .is_none(),
            "{extension}"
        );
    }
}

#[test]
fn clears_numbering_without_dropping_existing_totals() {
    let fixture = Fixture::new();
    let path = fixture.0.join("totals.m4a");
    fs::write(&path, include_bytes!("../../../../fixtures/silence.m4a")).unwrap();
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

#[test]
fn adapter_write_preserves_database_snapshot_and_prior_success_after_a_missing_target() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let database = crate::database::Database::open(":memory:").unwrap();
    let snapshot = files::read_track(&path).unwrap().unwrap();
    database.upsert_track(&snapshot, None).unwrap();
    let changes = [change(MetadataField::Title, Some("Written title"))];
    let results = [
        files::write_file(&path, &changes),
        files::write_file(&fixture.0.join("missing.wav"), &changes),
    ];
    assert!(results[0].is_ok());
    assert!(results[1].is_err());
    assert_eq!(
        files::read_track(&path).unwrap().unwrap().title.as_deref(),
        Some("Written title")
    );
    assert_eq!(
        database.get_track(1).unwrap().unwrap().title,
        snapshot.title
    );
}
