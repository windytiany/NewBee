use super::*;
use lofty::id3::v2::{BinaryFrame, Frame, FrameId, Id3v2Tag};
use std::io::Write;

fn prefix(length: usize) -> Vec<u8> {
    let mut tag = Id3v2Tag::new();
    tag.insert(Frame::Binary(BinaryFrame::new(
        FrameId::new("XABC").unwrap(),
        vec![1; length - 20],
    )));
    let mut bytes = Vec::new();
    tag.dump_to(&mut bytes, WriteOptions::default().preferred_padding(0))
        .unwrap();
    assert_eq!(bytes.len(), length);
    bytes
}

fn fixture(bytes: &[u8]) -> (TemporaryFile, File) {
    let (temporary, mut file) =
        TemporaryFile::create(&std::env::temp_dir().join("aac-test.aac")).unwrap();
    file.write_all(bytes).unwrap();
    file.rewind().unwrap();
    (temporary, file)
}

#[test]
fn decoder_guard_matches_underflow_zero_step_and_trailing_tag_boundaries() {
    let audio = include_bytes!("../../../fixtures/silence.aac");
    for (prefix_len, accepted) in [
        (82, false),
        (81, false),
        (80, false),
        (78, false),
        (77, true),
    ] {
        let mut bytes = prefix(prefix_len);
        bytes.extend_from_slice(audio);
        let (temporary, mut file) = fixture(&bytes);
        let before = fs::read(&temporary.0).unwrap();
        assert_eq!(
            aac_playability::verify(&temporary.0, &mut file).is_ok(),
            accepted,
            "prefix={prefix_len}"
        );
        assert_eq!(fs::read(&temporary.0).unwrap(), before);
        if accepted {
            assert!(!rodio::Decoder::try_from(File::open(&temporary.0).unwrap())
                .unwrap()
                .collect::<Vec<_>>()
                .is_empty());
        }
    }
    // Symphonia byte_len includes a trailing ID3v1 tag. Its 128 bytes must be
    // included in the same estimate, rather than treated as a leading prefix.
    let mut bytes = prefix(81);
    bytes.extend_from_slice(audio);
    let (temporary, mut file) = fixture(&bytes);
    let mut trailer = Tag::new(TagType::Id3v1);
    trailer.set_title("tail".to_owned());
    trailer.save_to(&mut file, WriteOptions::default()).unwrap();
    assert_eq!(file.metadata().unwrap().len(), bytes.len() as u64 + 128);
    assert!(aac_playability::verify(&temporary.0, &mut file).is_ok());
    assert!(!rodio::Decoder::try_from(File::open(&temporary.0).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
    // Two existing ID3 prefixes must count towards the actual ADTS start.
    let mut bytes = prefix(41);
    bytes.extend_from_slice(&prefix(41));
    bytes.extend_from_slice(audio);
    let (temporary, mut file) = fixture(&bytes);
    assert!(aac_playability::verify(&temporary.0, &mut file).is_err());
    let mut bytes = prefix(40);
    bytes.extend_from_slice(&[0; 10]);
    bytes.extend_from_slice(audio);
    let (temporary, mut file) = fixture(&bytes);
    assert!(aac_playability::verify(&temporary.0, &mut file)
        .unwrap_err()
        .contains("音频起点"));
    assert_eq!(fs::read(&temporary.0).unwrap(), bytes);
}

#[test]
fn short_aac_rejects_unsafe_writes_without_changing_original_and_cover_deletion_can_repair_it() {
    let audio = include_bytes!("../../../fixtures/silence.aac");
    let (temporary, file) = fixture(audio);
    drop(file);
    let change = MetadataChange {
        field: MetadataField::Title,
        value: Some("new".into()),
        values: vec![],
    };
    let error = write_file(&temporary.0, &[change]).unwrap_err();
    assert!(error.contains("当前播放解码器"));
    assert_eq!(fs::read(&temporary.0).unwrap(), audio);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap());
    tag.save_to_path(&temporary.0, WriteOptions::default())
        .unwrap();
    write_file_with_cover(&temporary.0, &[], Some(CoverAction::Delete)).unwrap();
    assert_eq!(fs::read(&temporary.0).unwrap(), audio);
    assert!(!rodio::Decoder::try_from(File::open(&temporary.0).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
}

#[test]
fn long_aac_rejects_oversized_front_cover_and_preserves_payload_on_valid_cover_changes() {
    let audio = include_bytes!("../../../fixtures/silence.aac").repeat(1024);
    let (temporary, file) = fixture(&audio);
    drop(file);
    let mut random = 1u32;
    let pixels = image::RgbImage::from_fn(300, 300, |_, _| {
        let mut pixel = [0; 3];
        for channel in &mut pixel {
            random = random.wrapping_mul(1664525).wrapping_add(1013904223);
            *channel = (random >> 16) as u8;
        }
        image::Rgb(pixel)
    });
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(pixels)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    assert!(png.get_ref().len() > audio.len());
    let huge = cover_picture(png.get_ref()).unwrap();
    let error =
        write_file_with_cover(&temporary.0, &[], Some(CoverAction::Replace(&huge))).unwrap_err();
    assert!(error.contains("当前播放解码器"));
    assert_eq!(fs::read(&temporary.0).unwrap(), audio);
    let small = cover_picture(include_bytes!("../../../fixtures/cover.png")).unwrap();
    write_file_with_cover(&temporary.0, &[], Some(CoverAction::Replace(&small))).unwrap();
    let before_delete = fs::read(&temporary.0).unwrap();
    assert!(before_delete.ends_with(&audio));
    assert!(!rodio::Decoder::try_from(File::open(&temporary.0).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
    let error =
        write_file_with_cover(&temporary.0, &[], Some(CoverAction::Replace(&huge))).unwrap_err();
    assert!(error.contains("当前播放解码器"));
    assert_eq!(fs::read(&temporary.0).unwrap(), before_delete);
    write_file_with_cover(&temporary.0, &[], Some(CoverAction::Delete)).unwrap();
    assert_eq!(fs::read(&temporary.0).unwrap(), audio);
    assert!(!rodio::Decoder::try_from(File::open(&temporary.0).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
}
