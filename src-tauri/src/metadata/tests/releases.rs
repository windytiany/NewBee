use super::support::{change, long_aac_audio, Fixture};
use crate::metadata::{
    files,
    model::{MetadataChange, MetadataField},
};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    prelude::*,
    tag::{ItemKey, ItemValue, TagItem},
};
use rodio::Source;
use std::{fs, io::Seek};

#[test]
fn selected_release_fields_and_identifier_lists_round_trip_in_every_format() {
    let fixture = Fixture::new();
    let mut paths = vec![fixture.wav()];
    let aac = long_aac_audio();
    for (extension, bytes) in [
        (
            "mp3",
            include_bytes!("../../../fixtures/silence.mp3").as_slice(),
        ),
        ("aac", aac.as_slice()),
        (
            "m4a",
            include_bytes!("../../../fixtures/silence.m4a").as_slice(),
        ),
        (
            "ogg",
            include_bytes!("../../../fixtures/silence.ogg").as_slice(),
        ),
        (
            "flac",
            include_bytes!("../../../fixtures/silence.flac").as_slice(),
        ),
    ] {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        paths.push(path);
    }
    let artist_ids = vec![
        "76df3287-6cda-33eb-8e9a-044b5e15ffdd".to_owned(),
        "89ad4ac3-39f7-470e-963a-56509c546377".to_owned(),
    ];
    for path in paths {
        let before_payload = (path.extension().is_some_and(|extension| extension == "aac"))
            .then(|| aac_payload(&path));
        let before_decoder = rodio::Decoder::try_from(fs::File::open(&path).unwrap())
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert!(
            before_decoder.total_duration().is_some(),
            "{}",
            path.display()
        );
        let before_audio = before_decoder.collect::<Vec<_>>();
        assert!(!before_audio.is_empty(), "{}", path.display());
        let mut original = lofty::read_from_path(&path).unwrap();
        let primary = original.primary_tag_type();
        if original.primary_tag().is_none() {
            original.insert_tag(lofty::tag::Tag::new(primary));
        }
        let tag = original.primary_tag_mut().unwrap();
        tag.insert_text(ItemKey::Comment, "personal comment".into());
        tag.push(TagItem::new(
            ItemKey::MusicBrainzArtistId,
            ItemValue::Text("old-id".into()),
        ));
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let mut changes = vec![
            change(MetadataField::ArtistSort, Some("Artist, The")),
            change(MetadataField::AlbumArtistSort, Some("Album Artist, The")),
            change(MetadataField::DiscSubtitle, Some("第二碟")),
            change(MetadataField::Label, Some("Label")),
            change(MetadataField::ReleaseDate, Some("2024-02-29")),
            change(MetadataField::OriginalReleaseDate, Some("1998-03")),
        ];
        for field in MetadataField::IDENTIFIERS {
            changes.push(MetadataChange {
                field,
                value: None,
                values: if matches!(
                    field,
                    MetadataField::MusicBrainzArtistId | MetadataField::MusicBrainzAlbumArtistId
                ) {
                    artist_ids.clone()
                } else {
                    vec![artist_ids[0].clone()]
                },
            });
        }
        crate::metadata::model::normalize_changes(&mut changes).unwrap();
        files::write_file(&path, &changes)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let written = lofty::read_from_path(&path).unwrap();
        let tag = written.primary_tag().unwrap();
        assert_eq!(tag.get_string(ItemKey::Comment), Some("personal comment"));
        for update in &changes {
            if MetadataField::IDENTIFIERS.contains(&update.field) {
                assert_eq!(
                    tag.get_strings(update.field.key(tag.tag_type()))
                        .collect::<Vec<_>>(),
                    update.values.iter().map(String::as_str).collect::<Vec<_>>(),
                    "{}: {:?}",
                    path.display(),
                    update.field
                );
            } else {
                assert_eq!(
                    tag.get_string(update.field.key(tag.tag_type())),
                    update.value.as_deref()
                );
            }
        }
        let snapshot = files::read_track(&path).unwrap().unwrap();
        assert_eq!(snapshot.release_date.as_deref(), Some("2024-02-29"));
        assert_eq!(
            snapshot.editing.unwrap().values[&MetadataField::OriginalReleaseDate],
            "1998-03"
        );
        if primary == lofty::tag::TagType::Id3v2 {
            assert!(fs::read(&path)
                .unwrap()
                .windows(b"http://musicbrainz.org".len())
                .any(|window| window == b"http://musicbrainz.org"));
        }
        // Empty ID lists mean keep, never clear or merge.
        files::write_file(
            &path,
            &[MetadataChange {
                field: MetadataField::MusicBrainzArtistId,
                value: None,
                values: vec![],
            }],
        )
        .unwrap();
        assert_eq!(
            lofty::read_from_path(&path)
                .unwrap()
                .primary_tag()
                .unwrap()
                .get_strings(ItemKey::MusicBrainzArtistId)
                .collect::<Vec<_>>(),
            artist_ids.iter().map(String::as_str).collect::<Vec<_>>()
        );
        let clear = MetadataField::ALL
            .into_iter()
            .filter(|field| {
                matches!(
                    field,
                    MetadataField::ArtistSort
                        | MetadataField::AlbumArtistSort
                        | MetadataField::DiscSubtitle
                        | MetadataField::Label
                        | MetadataField::OriginalReleaseDate
                )
            })
            .map(|field| change(field, None))
            .collect::<Vec<_>>();
        files::write_file(&path, &clear).unwrap();
        let written = lofty::read_from_path(&path).unwrap();
        let tag = written.primary_tag().unwrap();
        for update in clear {
            assert!(tag.get_string(update.field.key(tag.tag_type())).is_none());
        }
        assert_eq!(tag.get_string(ItemKey::Comment), Some("personal comment"));
        assert_eq!(tag.get_string(ItemKey::RecordingDate), Some("2024-02-29"));
        let after_decoder = rodio::Decoder::try_from(fs::File::open(&path).unwrap())
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert!(
            after_decoder.total_duration().is_some(),
            "{}",
            path.display()
        );
        let after_audio = after_decoder.collect::<Vec<_>>();
        assert_eq!(after_audio, before_audio, "{}", path.display());
        if let Some(before_payload) = before_payload {
            assert_eq!(aac_payload(&path), before_payload);
        }
    }
}

fn aac_payload(path: &std::path::Path) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(fs::read(path).unwrap());
    lofty::tag::TagType::Id3v1
        .remove_from(&mut bytes, WriteOptions::default().preferred_padding(0))
        .unwrap();
    bytes.rewind().unwrap();
    lofty::tag::TagType::Id3v2
        .remove_from(&mut bytes, WriteOptions::default().preferred_padding(0))
        .unwrap();
    bytes.into_inner()
}

#[test]
fn clearing_wav_title_cannot_resurrect_riff_title_or_erase_custom_riff_data() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut riff = lofty::iff::wav::RiffInfoList::new();
    riff.set_title("old RIFF title".into());
    riff.insert("XTRA".into(), "keep".into());
    riff.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(&path, &[change(MetadataField::Title, None)]).unwrap();
    assert!(files::read_track(&path).unwrap().unwrap().title.is_none());
    let native = lofty::iff::wav::WavFile::read_from(
        &mut fs::File::open(&path).unwrap(),
        lofty::config::ParseOptions::default(),
    )
    .unwrap();
    assert_eq!(native.riff_info().unwrap().get("XTRA"), Some("keep"));
}

#[test]
fn replacing_or_deleting_cover_also_cleans_secondary_flac_id3_images() {
    let fixture = Fixture::new();
    let path = fixture.0.join("mixed.flac");
    fs::write(&path, include_bytes!("../../../fixtures/silence.flac")).unwrap();
    let cover = files::cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    let mut secondary = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
    secondary.insert_text(ItemKey::Comment, "secondary comment".into());
    secondary.push_picture(cover.clone());
    let mut native = lofty::id3::v2::Id3v2Tag::from(secondary);
    let private = lofty::id3::v2::Frame::Private(lofty::id3::v2::PrivateFrame::new(
        "newbee.test",
        vec![0, 1, 255, 2],
    ));
    let binary = lofty::id3::v2::Frame::Binary(lofty::id3::v2::BinaryFrame::new(
        lofty::id3::v2::FrameId::new("XABC").unwrap(),
        vec![3, 0, 254, 4],
    ));
    native.insert(private.clone());
    native.insert(binary.clone());
    let mut prefix = Vec::new();
    native
        .dump_to(&mut prefix, WriteOptions::default().preferred_padding(0))
        .unwrap();
    let original_prefix = prefix.clone();
    prefix.extend_from_slice(include_bytes!("../../../fixtures/silence.flac"));
    fs::write(&path, prefix).unwrap();
    let original = fs::read(&path).unwrap();
    files::write_file(
        &path,
        &[change(MetadataField::Title, Some("unrelated edit"))],
    )
    .unwrap();
    assert!(fs::read(&path).unwrap().starts_with(&original_prefix));
    assert_eq!(
        lofty::read_from_path(&path)
            .unwrap()
            .tag(lofty::tag::TagType::Id3v2)
            .unwrap()
            .pictures()
            .len(),
        1
    );
    let before_failure = fs::read(&path).unwrap();
    assert!(files::write_file_with_cover(
        &path,
        &[
            change(MetadataField::TrackNumber, Some("2")),
            change(MetadataField::TrackTotal, Some("1"))
        ],
        Some(files::CoverAction::Delete)
    )
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), before_failure);
    assert!(original.starts_with(&original_prefix));
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover))).unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    assert_eq!(written.primary_tag().unwrap().pictures().len(), 1);
    let secondary = written.tag(lofty::tag::TagType::Id3v2).unwrap();
    assert!(secondary.pictures().is_empty());
    assert_eq!(
        secondary.get_string(ItemKey::Comment),
        Some("secondary comment")
    );
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Delete)).unwrap();
    assert!(lofty::read_from_path(&path)
        .unwrap()
        .tags()
        .iter()
        .all(|tag| tag.pictures().is_empty()));
    assert!(files::read_track(&path).unwrap().unwrap().artwork.is_none());
    let native = lofty::flac::FlacFile::read_from(
        &mut fs::File::open(&path).unwrap(),
        lofty::config::ParseOptions::default(),
    )
    .unwrap();
    let native = native.id3v2().unwrap();
    assert!(native.iter().any(|frame| frame == &private));
    assert!(native.iter().any(|frame| frame == &binary));
    assert!(rodio::Decoder::try_from(fs::File::open(&path).unwrap())
        .unwrap()
        .next()
        .is_some());
    assert_eq!(
        lofty::read_from_path(&path)
            .unwrap()
            .primary_tag()
            .unwrap()
            .title()
            .as_deref(),
        Some("unrelated edit")
    );
    assert_eq!(
        lofty::read_from_path(&path)
            .unwrap()
            .tag(lofty::tag::TagType::Id3v2)
            .unwrap()
            .get_string(ItemKey::Comment),
        Some("secondary comment")
    );
}
