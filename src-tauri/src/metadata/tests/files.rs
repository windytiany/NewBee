use super::super::{
    files,
    model::{normalize_changes, MetadataField},
};
use super::support::{change, Fixture};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::{fs, path::PathBuf};

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
    assert_eq!(tag.get_string(ItemKey::Comment), Some("keep comment"));
    assert_eq!(tag.track_total(), Some(12));
    assert!(tag.get_string(ItemKey::RecordingDate).is_none());
    assert_eq!(
        file.tag(TagType::RiffInfo).unwrap().title().as_deref(),
        Some("secondary title")
    );
    let bytes = fs::read(&path).unwrap();
    let audio_start = bytes.windows(4).position(|chunk| chunk == b"data").unwrap() + 8;
    assert_eq!(&bytes[audio_start..audio_start + 8000], &[128; 8000]);
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

fn assert_tag_values_preserved(expected: &Tag, actual: &Tag) {
    assert_eq!(actual.track(), expected.track());
    assert_eq!(actual.track_total(), expected.track_total());
    assert_eq!(actual.disk(), expected.disk());
    assert_eq!(actual.disk_total(), expected.disk_total());
    for item in expected.items().filter(|item| {
        !matches!(
            item.key(),
            ItemKey::TrackNumber | ItemKey::TrackTotal | ItemKey::DiscNumber | ItemKey::DiscTotal
        )
    }) {
        assert_eq!(
            actual
                .get_strings(item.key())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>(),
            expected
                .get_strings(item.key())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>(),
            "{:?}",
            item.key()
        );
    }
}

#[test]
fn lyrics_write_preserves_existing_id3_text_frames() {
    use lofty::id3::v2::{Frame, FrameId, Id3v2Tag, TextInformationFrame};
    use lofty::TextEncoding;
    for (id, value) in [
        ("TRCK", "01/012"),
        ("TPOS", "01/02"),
        ("TCON", "(17)"),
        ("TPE1", "Artist\0Guest"),
        ("TPE2", "Album Artist\0Guest"),
        ("TCOM", "Composer\0Co-composer"),
        ("TCON", "Rock\0Pop"),
        ("TIT2", "Song"),
        ("TDRC", "2020-01-01"),
    ] {
        let fixture = Fixture::new();
        let path = fixture.wav();
        let mut tag = Id3v2Tag::default();
        tag.insert(Frame::Text(TextInformationFrame::new(
            FrameId::new(id).unwrap(),
            TextEncoding::UTF8,
            value,
        )));
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let before = lofty::read_from_path(&path).unwrap();
        let expected = before.primary_tag().unwrap();
        let result = files::write_file(
            &path,
            &[change(MetadataField::Lyrics, Some("downloaded lyrics"))],
        );
        assert!(result.is_ok(), "{id}={value:?}: {result:?}");
        let written = lofty::read_from_path(&path).unwrap();
        let after = written.primary_tag().unwrap();
        assert_eq!(
            after.get_string(MetadataField::Lyrics.key(after.tag_type())),
            Some("downloaded lyrics")
        );
        assert_tag_values_preserved(expected, after);
    }
}

#[test]
fn lyrics_write_preserves_multivalue_id3_and_number_values_across_formats() {
    use lofty::id3::v2::{Frame, FrameId, Id3v2Tag, TextInformationFrame};
    use lofty::TextEncoding;
    for extension in ["mp3", "aac", "wav"] {
        let fixture = Fixture::new();
        let path = fixture.0.join(format!("track.{extension}"));
        match extension {
            "mp3" => fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap(),
            "aac" => fs::write(&path, include_bytes!("../../../fixtures/silence.aac")).unwrap(),
            _ => {
                fixture.wav();
            }
        }
        let mut tag = Id3v2Tag::default();
        for (id, value) in [
            ("TRCK", "01/012"),
            ("TPOS", "01/02"),
            ("TPE1", "Artist\0Guest"),
            ("TPE2", "Album Artist\0Guest"),
            ("TCOM", "Composer\0Co-composer"),
            ("TCON", "Rock\0Pop"),
        ] {
            tag.insert(Frame::Text(TextInformationFrame::new(
                FrameId::new(id).unwrap(),
                TextEncoding::UTF8,
                value,
            )));
        }
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let before = lofty::read_from_path(&path).unwrap();
        files::write_file(
            &path,
            &[change(MetadataField::Lyrics, Some("downloaded lyrics"))],
        )
        .unwrap();
        let written = lofty::read_from_path(&path).unwrap();
        let after = written.primary_tag().unwrap();
        assert_eq!(
            after.get_string(MetadataField::Lyrics.key(after.tag_type())),
            Some("downloaded lyrics")
        );
        assert_tag_values_preserved(before.primary_tag().unwrap(), after);
    }
}

fn flac_audio(bytes: &[u8]) -> &[u8] {
    assert_eq!(&bytes[..4], b"fLaC");
    let mut audio_start = 4;
    loop {
        let header = &bytes[audio_start..audio_start + 4];
        let length = u32::from_be_bytes([0, header[1], header[2], header[3]]) as usize;
        audio_start += 4 + length;
        if header[0] & 0x80 != 0 {
            break;
        }
    }
    &bytes[audio_start..]
}

fn read_flac_comments(path: &std::path::Path) -> lofty::ogg::tag::VorbisComments {
    lofty::flac::FlacFile::read_from(
        &mut fs::File::open(path).unwrap(),
        lofty::config::ParseOptions::default(),
    )
    .unwrap()
    .remove_vorbis_comments()
    .unwrap()
}

fn flac_with_comments(fixture: &Fixture, comments: &[&str]) -> PathBuf {
    let source = include_bytes!("../../../fixtures/silence.flac");
    let mut block = Vec::new();
    block.extend_from_slice(&4u32.to_le_bytes());
    block.extend_from_slice(b"test");
    block.extend_from_slice(&(comments.len() as u32).to_le_bytes());
    for comment in comments {
        block.extend_from_slice(&(comment.len() as u32).to_le_bytes());
        block.extend_from_slice(comment.as_bytes());
    }
    let mut bytes = source[..42].to_vec(); // marker, STREAMINFO header and 34-byte payload
    bytes[4] = 0; // The comment block is now the last metadata block.
    bytes.push(0x84);
    bytes.extend_from_slice(&(block.len() as u32).to_be_bytes()[1..]);
    bytes.extend_from_slice(&block);
    bytes.extend_from_slice(flac_audio(source));
    let path = fixture.0.join("track.flac");
    fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn lyrics_write_allows_empty_flac_comments_to_be_removed() {
    let fixture = Fixture::new();
    let path = flac_with_comments(
        &fixture,
        &[
            "TITLE=Song",
            "GENRE=",
            "CUSTOM=keep custom",
            "EMPTY_CUSTOM=",
            "ARTIST=",
            "ARTIST=Guest",
            "TRACKNUMBER=02",
        ],
    );
    let before = lofty::read_from_path(&path).unwrap();
    let expected = before.primary_tag().unwrap();
    assert_eq!(expected.get_string(ItemKey::Genre), Some(""));
    files::write_file(
        &path,
        &[change(MetadataField::Lyrics, Some("downloaded lyrics"))],
    )
    .unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    let after = written.primary_tag().unwrap();
    assert_eq!(after.get_string(ItemKey::Lyrics), Some("downloaded lyrics"));
    assert_eq!(after.get_string(ItemKey::Genre), None);
    let comments = read_flac_comments(&path);
    assert_eq!(comments.get("CUSTOM"), Some("keep custom"));
    assert_eq!(comments.get("EMPTY_CUSTOM"), None);
    assert_tag_values_preserved(expected, after);
    assert_eq!(
        flac_audio(&fs::read(&path).unwrap()),
        flac_audio(include_bytes!("../../../fixtures/silence.flac"))
    );
    // Clearing a nonempty field still removes it without resurrecting old values.
    files::write_file(&path, &[change(MetadataField::Artist, None)]).unwrap();
    let cleared = lofty::read_from_path(&path).unwrap();
    let tag = cleared.primary_tag().unwrap();
    assert_eq!(tag.get_string(ItemKey::TrackArtist), None);
    assert_eq!(tag.get_string(ItemKey::Genre), None);
    let comments = read_flac_comments(&path);
    assert_eq!(comments.get("CUSTOM"), Some("keep custom"));
    assert_eq!(comments.get("EMPTY_CUSTOM"), None);
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn lyrics_write_preserves_flac_audio_without_padding() {
    let fixture = Fixture::new();
    let path = flac_with_comments(&fixture, &["TITLE=Song"]);
    files::write_file(
        &path,
        &[change(MetadataField::Lyrics, Some("downloaded lyrics"))],
    )
    .unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    assert_eq!(
        written.primary_tag().unwrap().get_string(ItemKey::Lyrics),
        Some("downloaded lyrics")
    );
    assert_eq!(
        flac_audio(&fs::read(&path).unwrap()),
        flac_audio(include_bytes!("../../../fixtures/silence.flac"))
    );
}

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
    assert!(error.contains("字段 title 写入后回读不一致"), "{error}");
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn native_vorbis_edit_preserves_encoder_vendor_custom_fields_and_alias_totals() {
    let fixture = Fixture::new();
    for (extension, bytes) in [
        (
            "flac",
            include_bytes!("../../../fixtures/silence.flac").as_slice(),
        ),
        (
            "ogg",
            include_bytes!("../../../fixtures/silence.ogg").as_slice(),
        ),
    ] {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        let read_comments = || {
            if extension == "flac" {
                read_flac_comments(&path)
            } else {
                lofty::ogg::VorbisFile::read_from(
                    &mut fs::File::open(&path).unwrap(),
                    lofty::config::ParseOptions::default(),
                )
                .unwrap()
                .remove_vorbis_comments()
            }
        };
        let mut comments = read_comments();
        for (key, value) in [
            ("ENCODER", "keep encoder"),
            ("CUSTOM", "keep custom"),
            ("TRACKNUMBER", "02"),
            ("TOTALTRACKS", "012"),
            ("DATE", "2016-02-19"),
        ] {
            comments.insert(key.into(), value.into());
        }
        comments
            .save_to_path(&path, WriteOptions::default())
            .unwrap();
        let vendor = read_comments().vendor().to_owned();
        files::write_file(
            &path,
            &[
                change(MetadataField::TrackNumber, Some("3")),
                change(MetadataField::ReleaseDate, None),
                change(MetadataField::Lyrics, Some("[00:01.00]lyrics")),
            ],
        )
        .unwrap();
        let written = read_comments();
        assert_eq!(written.vendor(), vendor);
        assert_eq!(written.get("ENCODER"), Some("keep encoder"));
        assert_eq!(written.get("CUSTOM"), Some("keep custom"));
        assert_eq!(written.track(), Some(3));
        assert_eq!(written.track_total(), Some(12));
        assert_eq!(written.get("DATE"), None);
        assert_eq!(written.get("RELEASEDATE"), None);
        assert_eq!(written.get("LYRICS"), Some("[00:01.00]lyrics"));
        if extension == "flac" {
            assert_eq!(flac_audio(&fs::read(&path).unwrap()), flac_audio(bytes));
        }
    }
}

#[test]
fn fallback_native_tags_preserve_unmapped_fields() {
    let fixture = Fixture::new();
    let wav = fixture.wav();
    let mut riff = lofty::iff::wav::RiffInfoList::new();
    riff.set_title("old".into());
    riff.insert("XTRA".into(), "keep custom".into());
    riff.save_to_path(&wav, WriteOptions::default()).unwrap();
    files::write_file(&wav, &[change(MetadataField::Title, Some("new"))]).unwrap();
    let written = lofty::iff::wav::WavFile::read_from(
        &mut fs::File::open(&wav).unwrap(),
        lofty::config::ParseOptions::default(),
    )
    .unwrap();
    let riff = written.riff_info().unwrap();
    assert_eq!(riff.title().as_deref(), Some("new"));
    assert_eq!(riff.get("XTRA"), Some("keep custom"));

    let mp3 = fixture.0.join("ape.mp3");
    fs::write(&mp3, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&mp3)
        .unwrap();
    TagType::Id3v2
        .remove_from(&mut file, WriteOptions::default().preferred_padding(0))
        .unwrap();
    drop(file);
    let mut ape = lofty::ape::ApeTag::new();
    ape.set_title("old".into());
    ape.insert(
        lofty::ape::ApeItem::new(
            "CUSTOM".into(),
            lofty::tag::ItemValue::Text("keep custom".into()),
        )
        .unwrap(),
    );
    ape.save_to_path(&mp3, WriteOptions::default()).unwrap();
    files::write_file(&mp3, &[change(MetadataField::Title, Some("new"))]).unwrap();
    let written = lofty::mpeg::MpegFile::read_from(
        &mut fs::File::open(&mp3).unwrap(),
        lofty::config::ParseOptions::default(),
    )
    .unwrap();
    let ape = written.ape().unwrap();
    assert_eq!(ape.title().as_deref(), Some("new"));
    assert_eq!(
        ape.get("CUSTOM").unwrap().value().text(),
        Some("keep custom")
    );
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
    let fixtures: &[(&str, &[u8])] = &[
        ("mp3", include_bytes!("../../../fixtures/silence.mp3")),
        ("aac", include_bytes!("../../../fixtures/silence.aac")),
        ("m4a", include_bytes!("../../../fixtures/silence.m4a")),
        ("ogg", include_bytes!("../../../fixtures/silence.ogg")),
        ("oga", include_bytes!("../../../fixtures/silence.ogg")),
        ("flac", include_bytes!("../../../fixtures/silence.flac")),
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
            crate::lyrics::local::embedded_lyrics_text(&file),
            Some("  [00:01.00]歌词\n[00:02.00]Second line\n\n")
        );
        let clear: Vec<_> = MetadataField::ALL
            .into_iter()
            .map(|field| change(field, None))
            .collect();
        files::write_file(&path, &clear)
            .unwrap_or_else(|error| panic!("{extension} clear: {error}"));
        assert!(
            crate::lyrics::local::embedded_lyrics_text(
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
fn id3v1_fallback_exposes_only_representable_fields() {
    let fixture = Fixture::new();
    let path = fixture.0.join("fallback.mp3");
    fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    TagType::Id3v2
        .remove_from(&mut file, WriteOptions::default().preferred_padding(0))
        .unwrap();
    drop(file);
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
    fs::write(&path, include_bytes!("../../../fixtures/silence.m4a")).unwrap();
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
    tag.insert_text(ItemKey::UnsyncLyrics, "untouched lyrics".to_owned());
    for picture_type in [PictureType::CoverFront, PictureType::CoverBack] {
        tag.push_picture(
            Picture::unchecked(include_bytes!("../../../fixtures/cover.png").to_vec())
                .pic_type(picture_type)
                .mime_type(MimeType::Png)
                .build(),
        );
    }
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(&path, &[change(MetadataField::Title, Some("new title"))]).unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    let tag = written.primary_tag().unwrap();
    assert_eq!(tag.pictures().len(), 2);
    assert_eq!(
        tag.pictures()[0].data(),
        include_bytes!("../../../fixtures/cover.png")
    );
    assert_eq!(
        tag.get_string(ItemKey::UnsyncLyrics),
        Some("untouched lyrics")
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
