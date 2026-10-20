use super::aac;
use crate::metadata::{
    files::{cover_picture, write_file, write_file_with_cover, CoverAction},
    model::{MetadataChange, MetadataField},
};
use lofty::{
    config::WriteOptions,
    id3::v2::{BinaryFrame, Frame, FrameId, Id3v2Tag},
    prelude::*,
    tag::{Tag, TagType},
};
use std::{
    fs::{self, File},
    io::{Seek, Write},
};

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

fn fixture(bytes: &[u8]) -> (tempfile::TempPath, File) {
    let (mut file, temporary) = tempfile::NamedTempFile::new().unwrap().into_parts();
    file.write_all(bytes).unwrap();
    file.rewind().unwrap();
    (temporary, file)
}

#[test]
fn decoder_guard_matches_underflow_zero_step_and_trailing_tag_boundaries() {
    let audio = include_bytes!("../../../../fixtures/silence.aac");
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
        let before = fs::read(&temporary).unwrap();
        assert_eq!(
            aac::verify(&temporary, &mut file).is_ok(),
            accepted,
            "prefix={prefix_len}"
        );
        assert_eq!(fs::read(&temporary).unwrap(), before);
        if accepted {
            assert!(!rodio::Decoder::try_from(File::open(&temporary).unwrap())
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
    assert!(aac::verify(&temporary, &mut file).is_ok());
    assert!(!rodio::Decoder::try_from(File::open(&temporary).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
    // Two existing ID3 prefixes must count towards the actual ADTS start.
    let mut bytes = prefix(41);
    bytes.extend_from_slice(&prefix(41));
    bytes.extend_from_slice(audio);
    let (temporary, mut file) = fixture(&bytes);
    assert!(aac::verify(&temporary, &mut file).is_err());
    let mut bytes = prefix(40);
    bytes.extend_from_slice(&[0; 10]);
    bytes.extend_from_slice(audio);
    let (temporary, mut file) = fixture(&bytes);
    assert!(aac::verify(&temporary, &mut file)
        .unwrap_err()
        .contains("音频起点"));
    assert_eq!(fs::read(&temporary).unwrap(), bytes);
}

#[test]
fn short_aac_rejects_unsafe_writes_without_changing_original_and_cover_deletion_can_repair_it() {
    let audio = include_bytes!("../../../../fixtures/silence.aac");
    let (temporary, file) = fixture(audio);
    drop(file);
    let change = MetadataChange {
        field: MetadataField::Title,
        value: Some("new".into()),
        values: vec![],
    };
    let error = write_file(&temporary, &[change]).unwrap_err();
    assert!(error.contains("当前播放解码器"));
    assert_eq!(fs::read(&temporary).unwrap(), audio);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(cover_picture(include_bytes!("../../../../fixtures/cover.png")).unwrap());
    tag.save_to_path(&temporary, WriteOptions::default())
        .unwrap();
    write_file_with_cover(&temporary, &[], Some(CoverAction::Delete)).unwrap();
    assert_eq!(fs::read(&temporary).unwrap(), audio);
    assert!(!rodio::Decoder::try_from(File::open(&temporary).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
}

#[test]
fn long_aac_rejects_oversized_front_cover_and_preserves_payload_on_valid_cover_changes() {
    let audio = include_bytes!("../../../../fixtures/silence.aac").repeat(1024);
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
        write_file_with_cover(&temporary, &[], Some(CoverAction::Replace(&huge))).unwrap_err();
    assert!(error.contains("当前播放解码器"));
    assert_eq!(fs::read(&temporary).unwrap(), audio);
    let small = cover_picture(include_bytes!("../../../../fixtures/cover.png")).unwrap();
    write_file_with_cover(&temporary, &[], Some(CoverAction::Replace(&small))).unwrap();
    let before_delete = fs::read(&temporary).unwrap();
    assert!(before_delete.ends_with(&audio));
    assert!(!rodio::Decoder::try_from(File::open(&temporary).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
    let error =
        write_file_with_cover(&temporary, &[], Some(CoverAction::Replace(&huge))).unwrap_err();
    assert!(error.contains("当前播放解码器"));
    assert_eq!(fs::read(&temporary).unwrap(), before_delete);
    write_file_with_cover(&temporary, &[], Some(CoverAction::Delete)).unwrap();
    assert_eq!(fs::read(&temporary).unwrap(), audio);
    assert!(!rodio::Decoder::try_from(File::open(&temporary).unwrap())
        .unwrap()
        .collect::<Vec<_>>()
        .is_empty());
}
