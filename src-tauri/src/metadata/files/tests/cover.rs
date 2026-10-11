use crate::metadata::tests::support::{change, long_aac_audio, Fixture};
use crate::metadata::{files, model::MetadataField};
use lofty::{
    config::WriteOptions,
    file::TaggedFileExt,
    picture::PictureType,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::fs;

#[test]
fn cover_operations_replace_or_delete_all_images_and_keep_unedited_images() {
    let fixture = Fixture::new();
    let mut paths = vec![fixture.wav()];
    let aac = long_aac_audio();
    for (extension, bytes) in [
        (
            "mp3",
            include_bytes!("../../../../fixtures/silence.mp3").as_slice(),
        ),
        ("aac", aac.as_slice()),
        (
            "m4a",
            include_bytes!("../../../../fixtures/silence.m4a").as_slice(),
        ),
        (
            "ogg",
            include_bytes!("../../../../fixtures/silence.ogg").as_slice(),
        ),
        (
            "flac",
            include_bytes!("../../../../fixtures/silence.flac").as_slice(),
        ),
    ] {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        paths.push(path);
    }
    let cover = files::cover_picture(include_bytes!("../../../../fixtures/cover.png")).unwrap();
    let mut front_bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 2, image::Rgb([255, 0, 0])))
        .write_to(&mut front_bytes, image::ImageFormat::Png)
        .unwrap();
    let first_front = files::cover_picture(front_bytes.get_ref()).unwrap();
    for path in paths {
        let original = lofty::read_from_path(&path).unwrap();
        let primary = original.primary_tag_type();
        let mut tag = Tag::new(primary);
        tag.insert_text(ItemKey::Comment, "keep comment".into());
        let mut back = cover.clone();
        back.set_pic_type(PictureType::CoverBack);
        tag.push_picture(back);
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let snapshot = files::read_track(&path).unwrap().unwrap();
        assert_eq!(
            snapshot.artwork.is_some(),
            primary == TagType::Mp4Ilst,
            "{}",
            path.display()
        );
        let mut old_front = first_front.clone();
        old_front.set_description(Some("old".into()));
        tag.push_picture(old_front);
        let mut another_front = cover.clone();
        another_front.set_description(Some("another".into()));
        tag.push_picture(another_front);
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        assert_eq!(
            files::read_track(&path)
                .unwrap()
                .unwrap()
                .artwork
                .unwrap()
                .image,
            if primary == TagType::Mp4Ilst {
                cover.data()
            } else {
                first_front.data()
            }
        );
        let before = lofty::read_from_path(&path)
            .unwrap()
            .primary_tag()
            .unwrap()
            .pictures()
            .to_vec();
        files::write_file(&path, &[change(MetadataField::Title, Some("new title"))]).unwrap();
        assert_eq!(
            lofty::read_from_path(&path)
                .unwrap()
                .primary_tag()
                .unwrap()
                .pictures(),
            before
        );
        files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover)))
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let written = lofty::read_from_path(&path).unwrap();
        let tag = written.primary_tag().unwrap();
        assert_eq!(tag.pictures().len(), 1);
        assert_eq!(tag.pictures()[0].data(), cover.data());
        assert_eq!(tag.get_string(ItemKey::Comment), Some("keep comment"));
        let bytes = fs::read(&path).unwrap();
        files::write_file_with_cover(&path, &[], Some(files::CoverAction::Replace(&cover)))
            .unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        files::write_file_with_cover(&path, &[], Some(files::CoverAction::Delete)).unwrap();
        assert!(lofty::read_from_path(&path)
            .unwrap()
            .tags()
            .iter()
            .all(|tag| tag.pictures().is_empty()));
        assert!(files::read_track(&path).unwrap().unwrap().artwork.is_none());
    }
}

#[test]
fn secondary_front_cover_is_read_without_falling_back_to_primary_back_cover() {
    let fixture = Fixture::new();
    let path = fixture.0.join("mixed.flac");
    fs::write(&path, include_bytes!("../../../../fixtures/silence.flac")).unwrap();
    let cover = files::cover_picture(include_bytes!("../../../../fixtures/cover.png")).unwrap();
    let mut primary = Tag::new(TagType::VorbisComments);
    let mut back = cover.clone();
    back.set_pic_type(PictureType::CoverBack);
    primary.push_picture(back);
    primary
        .save_to_path(&path, WriteOptions::default())
        .unwrap();
    assert!(files::read_track(&path).unwrap().unwrap().artwork.is_none());
    let mut secondary = Tag::new(TagType::Id3v2);
    secondary.insert_text(ItemKey::Comment, "keep prefix".into());
    secondary.push_picture(cover.clone());
    let mut prefix = Vec::new();
    secondary
        .dump_to(&mut prefix, WriteOptions::default().preferred_padding(0))
        .unwrap();
    let original_prefix = prefix.clone();
    prefix.extend_from_slice(&fs::read(&path).unwrap());
    fs::write(&path, prefix).unwrap();
    let before = lofty::read_from_path(&path).unwrap();
    assert_eq!(before.primary_tag().unwrap().pictures().len(), 1);
    assert_eq!(before.tag(TagType::Id3v2).unwrap().pictures().len(), 1);
    files::write_file(
        &path,
        &[change(MetadataField::ArtistSort, Some("Artist, The"))],
    )
    .unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    assert_eq!(
        written.primary_tag().unwrap().pictures(),
        before.primary_tag().unwrap().pictures()
    );
    assert_eq!(
        written.tag(TagType::Id3v2).unwrap().pictures(),
        before.tag(TagType::Id3v2).unwrap().pictures()
    );
    assert!(fs::read(&path).unwrap().starts_with(&original_prefix));
    assert_eq!(
        files::read_track(&path)
            .unwrap()
            .unwrap()
            .artwork
            .unwrap()
            .image,
        cover.data()
    );
    files::write_file_with_cover(&path, &[], Some(files::CoverAction::Delete)).unwrap();
    assert!(lofty::read_from_path(&path)
        .unwrap()
        .tags()
        .iter()
        .all(|tag| tag.pictures().is_empty()));
    assert!(files::read_track(&path).unwrap().unwrap().artwork.is_none());
}

#[test]
fn explicit_date_clear_removes_ecosystem_date_and_release_date_alias() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::RecordingDate, "1998".into());
    tag.insert_text(ItemKey::ReleaseDate, "2000".into());
    tag.insert_text(ItemKey::OriginalReleaseDate, "1990".into());
    tag.insert_text(ItemKey::TrackTitle, "keep".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(&path, &[change(MetadataField::ReleaseDate, None)]).unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    let tag = written.primary_tag().unwrap();
    assert!(tag.get_string(ItemKey::RecordingDate).is_none());
    assert!(tag.get_string(ItemKey::ReleaseDate).is_none());
    assert_eq!(tag.get_string(ItemKey::OriginalReleaseDate), Some("1990"));
}

#[test]
fn rejects_invalid_and_oversized_images() {
    assert!(files::cover_picture(b"not an image").is_err());
    assert!(files::cover_picture(&vec![0; files::MAX_COVER_BYTES + 1]).is_err());
}
