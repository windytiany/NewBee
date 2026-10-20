use crate::metadata::{
    files,
    model::MetadataField,
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
            "mp3" => fs::write(&path, include_bytes!("../../../../fixtures/silence.mp3")).unwrap(),
            "aac" => fs::write(&path, long_aac_audio()).unwrap(),
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

pub(super) fn flac_audio(bytes: &[u8]) -> &[u8] {
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
    let source = include_bytes!("../../../../fixtures/silence.flac");
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
        flac_audio(include_bytes!("../../../../fixtures/silence.flac"))
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
        flac_audio(include_bytes!("../../../../fixtures/silence.flac"))
    );
}

#[test]
fn native_vorbis_edit_preserves_encoder_vendor_custom_fields_and_alias_totals() {
    let fixture = Fixture::new();
    for (extension, bytes) in [
        (
            "flac",
            include_bytes!("../../../../fixtures/silence.flac").as_slice(),
        ),
        (
            "ogg",
            include_bytes!("../../../../fixtures/silence.ogg").as_slice(),
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
    assert_eq!(riff.title().as_deref(), Some("old"));
    assert_eq!(written.id3v2().unwrap().title().as_deref(), Some("new"));
    assert_eq!(riff.get("XTRA"), Some("keep custom"));

    let mp3 = fixture.0.join("ape.mp3");
    fs::write(&mp3, include_bytes!("../../../../fixtures/silence.mp3")).unwrap();
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
    assert_eq!(ape.title().as_deref(), Some("old"));
    assert_eq!(written.id3v2().unwrap().title().as_deref(), Some("new"));
    assert_eq!(
        ape.get("CUSTOM").unwrap().value().text(),
        Some("keep custom")
    );
}

#[test]
fn id3v1_only_files_are_edited_in_id3v2_and_keep_legacy_data() {
    let fixture = Fixture::new();
    let path = fixture.0.join("fallback.mp3");
    fs::write(&path, include_bytes!("../../../../fixtures/silence.mp3")).unwrap();
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
    assert!(writable.contains(&MetadataField::AlbumArtist));
    assert!(writable.contains(&MetadataField::DiscNumber));
    assert!(writable.contains(&MetadataField::ReleaseDate));
    files::write_file(&path, &[change(MetadataField::Title, Some("标题"))]).unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    assert_eq!(
        written.primary_tag().unwrap().title().as_deref(),
        Some("标题")
    );
    assert_eq!(
        written.tag(TagType::Id3v1).unwrap().title().as_deref(),
        Some("legacy")
    );
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
            Picture::unchecked(include_bytes!("../../../../fixtures/cover.png").to_vec())
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
        include_bytes!("../../../../fixtures/cover.png")
    );
    assert_eq!(
        tag.get_string(ItemKey::UnsyncLyrics),
        Some("untouched lyrics")
    );
}
