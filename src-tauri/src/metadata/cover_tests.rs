use super::{change, files, Fixture, MetadataField};
use lofty::{
    config::WriteOptions, file::TaggedFileExt, picture::PictureType, prelude::*, tag::ItemKey,
};
use std::fs;

#[test]
fn cover_round_trip_supported_formats_preserves_other_images_and_labels() {
    let fixture = Fixture::new();
    let wav = fixture.wav();
    let mut paths = vec![wav];
    for (extension, bytes) in [
        ("mp3", include_bytes!("fixtures/silence.mp3").as_slice()),
        ("aac", include_bytes!("fixtures/silence.aac").as_slice()),
        ("m4a", include_bytes!("fixtures/silence.m4a").as_slice()),
        ("ogg", include_bytes!("fixtures/silence.ogg").as_slice()),
        ("flac", include_bytes!("fixtures/silence.flac").as_slice()),
    ] {
        let path = fixture.0.join(format!("track.{extension}"));
        fs::write(&path, bytes).unwrap();
        paths.push(path);
    }
    let new_cover = files::cover_picture(include_bytes!("fixtures/cover.png")).unwrap();
    for path in paths {
        let mut original = lofty::read_from_path(&path).unwrap();
        let primary = original.primary_tag_type();
        if original.primary_tag().is_none() {
            original.insert_tag(lofty::tag::Tag::new(primary));
        }
        let tag = original.primary_tag_mut().unwrap();
        tag.insert_text(ItemKey::Lyrics, "keep lyrics".into());
        tag.insert_text(ItemKey::Comment, "keep comment".into());
        let mut old_front = new_cover.clone();
        old_front.set_description(Some("old".into()));
        let mut back = new_cover.clone();
        back.set_pic_type(PictureType::CoverBack);
        tag.push_picture(old_front);
        tag.push_picture(back);
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        let before = lofty::read_from_path(&path).unwrap();
        let is_mp4 = primary == lofty::tag::TagType::Mp4Ilst;
        let preserved = if is_mp4 {
            before.primary_tag().unwrap().pictures()[1..].to_vec()
        } else {
            before
                .primary_tag()
                .unwrap()
                .pictures()
                .iter()
                .filter(|picture| picture.pic_type() != PictureType::CoverFront)
                .cloned()
                .collect()
        };
        files::write_file_with_cover(
            &path,
            &[change(MetadataField::Title, Some("new title"))],
            Some(&new_cover),
        )
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let written = lofty::read_from_path(&path).unwrap();
        let tag = written.primary_tag().unwrap();
        assert_eq!(tag.title().as_deref(), Some("new title"));
        assert_eq!(tag.get_string(&ItemKey::Lyrics), Some("keep lyrics"));
        assert_eq!(tag.get_string(&ItemKey::Comment), Some("keep comment"));
        if is_mp4 {
            assert_eq!(tag.pictures()[0].data(), new_cover.data());
            assert_eq!(tag.pictures()[1..], preserved);
        } else {
            assert_eq!(
                tag.pictures()
                    .iter()
                    .filter(|picture| picture.pic_type() == PictureType::CoverFront)
                    .count(),
                1
            );
            let others: Vec<_> = tag
                .pictures()
                .iter()
                .filter(|picture| picture.pic_type() != PictureType::CoverFront)
                .cloned()
                .collect();
            assert_eq!(others, preserved);
        }
        // A cover-only reapply is a no-op, rather than another file replacement.
        let bytes = fs::read(&path).unwrap();
        files::write_file_with_cover(&path, &[], Some(&new_cover)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}
#[test]
fn explicit_date_clear_is_not_mistaken_for_a_noop_when_recording_date_exists() {
    let fixture = Fixture::new();
    let path = fixture.wav();
    let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
    tag.insert_text(ItemKey::RecordingDate, "1998".into());
    tag.insert_text(ItemKey::TrackTitle, "keep".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    files::write_file(&path, &[change(MetadataField::ReleaseDate, None)]).unwrap();
    let written = lofty::read_from_path(&path).unwrap();
    let tag = written.primary_tag().unwrap();
    assert!(tag.get_string(&ItemKey::RecordingDate).is_none());
    assert!(tag.get_string(&ItemKey::ReleaseDate).is_none());
    assert_eq!(tag.title().as_deref(), Some("keep"));
}

#[test]
fn rejects_invalid_and_oversized_images() {
    assert!(files::cover_picture(b"not an image").is_err());
    assert!(files::cover_picture(&vec![0; files::MAX_COVER_BYTES + 1]).is_err());
}
