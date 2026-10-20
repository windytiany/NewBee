use crate::artwork::{model::ArtworkContent, track::Picture};
use crate::metadata::{
    files,
    tests::support::{long_aac_audio, Fixture},
};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    picture::PictureType,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::{fs, io::Cursor, path::PathBuf};

fn paths(fixture: &Fixture) -> Vec<PathBuf> {
    let mut paths = vec![fixture.wav()];
    for (extension, bytes) in [
        (
            "mp3",
            include_bytes!("../../../../fixtures/silence.mp3").to_vec(),
        ),
        ("aac", long_aac_audio()),
        (
            "m4a",
            include_bytes!("../../../../fixtures/silence.m4a").to_vec(),
        ),
        (
            "ogg",
            include_bytes!("../../../../fixtures/silence.ogg").to_vec(),
        ),
        (
            "flac",
            include_bytes!("../../../../fixtures/silence.flac").to_vec(),
        ),
    ] {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        paths.push(path);
    }
    paths
}

fn picture(picture_type: u8) -> Picture {
    Picture {
        content: ArtworkContent {
            mime_type: "image/png".into(),
            image: include_bytes!("../../../../fixtures/cover.png").to_vec(),
        },
        picture_type,
    }
}

fn icon() -> Picture {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(32, 32, image::Rgb([0, 0, 0])))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    Picture {
        content: ArtworkContent {
            mime_type: "image/png".into(),
            image: bytes.into_inner(),
        },
        picture_type: 1,
    }
}

fn assert_pictures(path: &std::path::Path, expected: &[Picture]) {
    let scan = files::artwork::read_collection(path).embedded.unwrap();
    assert_eq!(scan.len(), expected.len(), "{}", path.display());
    for (actual, expected) in scan.iter().zip(expected) {
        assert_eq!(
            actual.picture_type,
            expected.picture_type,
            "{}",
            path.display()
        );
        assert_eq!(actual.content.mime_type, expected.content.mime_type);
        assert_eq!(actual.content.image, expected.content.image);
    }
}

#[test]
fn complete_collections_roundtrip_all_writable_formats_and_preserve_nonpicture_tags() {
    let fixture = Fixture::new();
    let directory = fixture.0.join("cover.png");
    let directory_bytes = picture(3).content.image;
    fs::write(&directory, &directory_bytes).unwrap();
    for path in paths(&fixture) {
        let original = lofty::read_from_path(&path).unwrap();
        let mut tag = Tag::new(original.primary_tag_type());
        tag.insert_text(ItemKey::TrackTitle, "unchanged title".into());
        tag.insert_text(ItemKey::Comment, "unchanged comment".into());
        let lyrics_key = if tag.tag_type() == TagType::Id3v2 {
            ItemKey::UnsyncLyrics
        } else {
            ItemKey::Lyrics
        };
        assert!(tag.insert_text(lyrics_key, "unchanged lyrics".into()));
        tag.push_picture(files::cover_picture(&directory_bytes).unwrap());
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let requested = if original.primary_tag_type() == TagType::Mp4Ilst {
            vec![picture(0), picture(0), picture(0)]
        } else {
            let mut pictures = (0..=20).map(picture).collect::<Vec<_>>();
            pictures[1] = icon();
            pictures.push(picture(3));
            pictures.push(picture(3));
            pictures
        };
        files::write_file_with_pictures(&path, &[], Some(&requested))
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert_pictures(&path, &requested);
        let written = lofty::read_from_path(&path).unwrap();
        let tag = written.primary_tag().unwrap();
        assert_eq!(tag.get_string(ItemKey::TrackTitle), Some("unchanged title"));
        assert_eq!(tag.get_string(ItemKey::Comment), Some("unchanged comment"));
        assert_eq!(
            files::lyrics::embedded_lyrics_text(&written),
            Some("unchanged lyrics"),
            "{}",
            path.display()
        );
        let bytes = fs::read(&path).unwrap();
        files::write_file_with_pictures(&path, &[], Some(&requested)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        files::write_file_with_pictures(&path, &[], Some(&[])).unwrap();
        assert_pictures(&path, &[]);
        assert_eq!(fs::read(&directory).unwrap(), directory_bytes);
    }
}

#[test]
fn replaces_flac_prefix_and_mpeg_ape_pictures_without_losing_native_fields() {
    let fixture = Fixture::new();
    for extension in ["flac", "mp3"] {
        let path = fixture.0.join(format!("secondary.{extension}"));
        let bytes = if extension == "flac" {
            include_bytes!("../../../../fixtures/silence.flac").as_slice()
        } else {
            include_bytes!("../../../../fixtures/silence.mp3").as_slice()
        };
        fs::write(&path, bytes).unwrap();
        let primary_type = if extension == "flac" {
            TagType::VorbisComments
        } else {
            TagType::Id3v2
        };
        let mut primary = Tag::new(primary_type);
        primary.insert_text(ItemKey::TrackTitle, "keep primary".into());
        primary.push_picture(files::cover_picture(&picture(3).content.image).unwrap());
        primary
            .save_to_path(&path, WriteOptions::default())
            .unwrap();
        if extension == "flac" {
            let mut secondary = lofty::id3::v2::Id3v2Tag::new();
            secondary.insert_user_text("NATIVE_CUSTOM".into(), "keep native".into());
            let mut native = files::cover_picture(&picture(4).content.image).unwrap();
            native.set_pic_type(PictureType::CoverBack);
            secondary.insert_picture(native);
            let mut prefix = Vec::new();
            secondary
                .dump_to(&mut prefix, WriteOptions::default().preferred_padding(0))
                .unwrap();
            prefix.extend_from_slice(&fs::read(&path).unwrap());
            fs::write(&path, prefix).unwrap();
        } else {
            let mut secondary = lofty::ape::ApeTag::new();
            secondary.insert(
                lofty::ape::ApeItem::new(
                    "NATIVE_CUSTOM".into(),
                    lofty::tag::ItemValue::Text("keep native".into()),
                )
                .unwrap(),
            );
            secondary.insert(
                lofty::ape::ApeItem::new(
                    "Cover Art (Back)".into(),
                    lofty::tag::ItemValue::Binary(
                        files::cover_picture(&picture(4).content.image)
                            .unwrap()
                            .as_ape_bytes(),
                    ),
                )
                .unwrap(),
            );
            secondary
                .save_to_path(&path, WriteOptions::default())
                .unwrap();
        }
        assert_eq!(
            files::artwork::read_collection(&path)
                .embedded
                .unwrap()
                .len(),
            2
        );
        let requested = vec![picture(3), picture(4), picture(5)];
        files::write_file_with_pictures(&path, &[], Some(&requested)).unwrap();
        assert_pictures(&path, &requested);
        let written = lofty::read_from_path(&path).unwrap();
        assert_eq!(
            written
                .primary_tag()
                .unwrap()
                .get_string(ItemKey::TrackTitle),
            Some("keep primary")
        );
        let mut source = fs::File::open(&path).unwrap();
        if extension == "flac" {
            let native = lofty::flac::FlacFile::read_from(&mut source, Default::default()).unwrap();
            assert_eq!(
                native.id3v2().unwrap().get_user_text("NATIVE_CUSTOM"),
                Some("keep native")
            );
            assert!(!native
                .id3v2()
                .unwrap()
                .iter()
                .any(|frame| matches!(frame, lofty::id3::v2::Frame::Picture(_))));
        } else {
            let native = lofty::mpeg::MpegFile::read_from(&mut source, Default::default()).unwrap();
            assert_eq!(
                native
                    .ape()
                    .unwrap()
                    .get("NATIVE_CUSTOM")
                    .unwrap()
                    .value()
                    .text(),
                Some("keep native")
            );
            assert!(native.ape().unwrap().get("Cover Art (Back)").is_none());
        }
        files::write_file_with_pictures(&path, &[], Some(&[])).unwrap();
        assert_pictures(&path, &[]);
    }
}

#[test]
fn unsupported_types_formats_and_invalid_images_do_not_change_files() {
    let fixture = Fixture::new();
    for path in paths(&fixture) {
        let before = fs::read(&path).unwrap();
        let mut wrong_mime = picture(0);
        wrong_mime.content.mime_type = "image/jpeg".into();
        let mut invalid = picture(0);
        invalid.content.image = b"not an image".to_vec();
        let mut oversized = picture(0);
        oversized
            .content
            .image
            .resize(files::MAX_COVER_BYTES + 1, 0);
        let mut cases = vec![
            vec![picture(21)],
            vec![picture(255)],
            vec![wrong_mime],
            vec![invalid],
            vec![oversized],
        ];
        if path.extension().unwrap() == "m4a" {
            cases.push(vec![picture(3)]);
            let mut bytes = Cursor::new(Vec::new());
            image::DynamicImage::new_rgb8(2, 2)
                .write_to(&mut bytes, image::ImageFormat::Tiff)
                .unwrap();
            cases.push(vec![Picture {
                content: ArtworkContent {
                    mime_type: "image/tiff".into(),
                    image: bytes.into_inner(),
                },
                picture_type: 0,
            }]);
        } else {
            cases.push(vec![picture(1)]);
            cases.push(vec![icon(), icon()]);
            cases.push(vec![picture(2), picture(2)]);
        }
        for requested in cases {
            assert!(
                files::write_file_with_pictures(&path, &[], Some(&requested)).is_err(),
                "{}",
                path.display()
            );
            assert_eq!(fs::read(&path).unwrap(), before);
        }
    }
    assert!(files::artwork::prepare_pictures(&[], TagType::Ape).is_err());
}
