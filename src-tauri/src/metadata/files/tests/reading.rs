use super::super::*;

#[test]
fn lightweight_mode_keeps_tags_capabilities_and_lyrics_without_materializing_pictures() {
    let directory = tempfile::tempdir().unwrap();
    let mut image = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        2048,
        2048,
        image::Rgb([17, 31, 45]),
    ))
    .write_to(&mut image, image::ImageFormat::Bmp)
    .unwrap();
    assert!(image.get_ref().len() > 10 * 1024 * 1024);
    let cover = cover_picture(image.get_ref()).unwrap();
    for (extension, audio) in [
        (
            "flac",
            include_bytes!("../../../../fixtures/silence.flac").as_slice(),
        ),
        (
            "mp3",
            include_bytes!("../../../../fixtures/silence.mp3").as_slice(),
        ),
        (
            "m4a",
            include_bytes!("../../../../fixtures/silence.m4a").as_slice(),
        ),
        (
            "ogg",
            include_bytes!("../../../../fixtures/silence.ogg").as_slice(),
        ),
    ] {
        let cover = if extension == "ogg" {
            cover_picture(include_bytes!("../../../../fixtures/cover.png")).unwrap()
        } else {
            cover.clone()
        };
        let path = directory.path().join(format!("track.{extension}"));
        fs::write(&path, audio).unwrap();
        write_file_with_cover(
            &path,
            &[
                MetadataChange {
                    field: MetadataField::Title,
                    value: Some("Confirmed title".into()),
                    values: Vec::new(),
                },
                MetadataChange {
                    field: MetadataField::Lyrics,
                    value: Some("Embedded words".into()),
                    values: Vec::new(),
                },
            ],
            Some(CoverAction::Replace(&cover)),
        )
        .unwrap();
        let file =
            read_file_with_options(&path, ParseOptions::default().read_cover_art(false)).unwrap();
        assert!(
            file.tags().iter().all(|tag| tag.pictures().is_empty()),
            "{extension}"
        );
        let light = read_track_metadata(&path).unwrap().unwrap();
        assert_eq!(light.title.as_deref(), Some("Confirmed title"));
        assert_eq!(light.lyrics.as_deref(), Some("Embedded words"));
        assert!(light.duration_ms.is_some());
        assert!(light
            .editing
            .unwrap()
            .writable_fields
            .contains(&MetadataField::Lyrics));
        let full = read_track_collection(&path).unwrap().unwrap();
        assert_eq!(full.embedded.unwrap()[0].content.image, cover.data());
    }
}
