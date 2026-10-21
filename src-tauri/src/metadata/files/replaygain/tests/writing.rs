use super::*;

#[test]
fn round_trips_native_tags_and_preserves_audio_and_other_metadata() {
    let dir = tempfile::tempdir().unwrap();
    for fixture in [
        "silence.mp3",
        "silence.flac",
        "silence.m4a",
        "silence.ogg",
        "alac/tone.m4a",
    ] {
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(fixture);
        let path = dir.path().join(fixture.replace('/', "."));
        fs::copy(&source, &path).unwrap();
        let before: Vec<_> = rodio::Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .collect();
        assert!(write(&path, measured(), true).unwrap(), "{fixture}");
        assert_eq!(read(&path).unwrap(), measured(), "{fixture}");
        let after: Vec<_> = rodio::Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .collect();
        assert_eq!(before, after, "{fixture}");
        let bytes = fs::read(&path).unwrap();
        assert!(!write(&path, measured(), false).unwrap());
        assert_eq!(bytes, fs::read(&path).unwrap());
    }
}

#[test]
#[ignore = "requires NEWBEE_REPLAYGAIN_REPRO_FILE pointing to a local audio file"]
fn replay_gain_preserves_local_file_metadata() {
    let source =
        std::path::PathBuf::from(std::env::var_os("NEWBEE_REPLAYGAIN_REPRO_FILE").unwrap());
    let original = fs::read(&source).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(source.file_name().unwrap());
    fs::copy(&source, &path).unwrap();
    let before = read_file(&path).unwrap();
    let result = write(&path, measured(), false);
    assert_eq!(fs::read(&source).unwrap(), original);
    assert!(result.is_ok(), "{result:?}");
    let after = read_file(&path).unwrap();
    for expected in before.tags() {
        let actual = after.tag(expected.tag_type()).unwrap();
        for item in expected.items().filter(|item| !is_replay_gain(item.key())) {
            assert!(
                actual.items().any(|candidate| candidate == item),
                "{item:?}"
            );
        }
        assert_eq!(expected.pictures(), actual.pictures());
    }
    assert_eq!(read(&path).unwrap(), measured());
}

#[test]
fn replay_gain_coalesces_identical_legacy_and_modern_id3_dates_without_losing_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dates.mp3");
    let fixture = include_bytes!("../../../../../fixtures/silence.mp3");
    let tag_size = fixture[6..10]
        .iter()
        .fold(0usize, |size, byte| (size << 7) | usize::from(*byte));
    let mut bytes = b"ID3\x03\0\0\0\0\0\x2e".to_vec();
    for (id, value) in [
        (b"TDOR", b"\x031994\0".as_slice()),
        (b"TYER", b"\x001994".as_slice()),
        (b"TORY", b"\x001994".as_slice()),
    ] {
        bytes.extend_from_slice(id);
        bytes.extend_from_slice(&(value.len() as u32).to_be_bytes());
        bytes.extend_from_slice(b"\0\0");
        bytes.extend_from_slice(value);
    }
    bytes.extend_from_slice(&fixture[10 + tag_size..]);
    fs::write(&path, bytes).unwrap();
    let before = read_file(&path).unwrap();
    let tag = before.tag(TagType::Id3v2).unwrap();
    assert_eq!(tag.get_items(ItemKey::OriginalReleaseDate).count(), 2);
    let audio: Vec<_> = rodio::Decoder::try_from(File::open(&path).unwrap())
        .unwrap()
        .collect();
    assert!(write(&path, measured(), false).unwrap());
    assert_eq!(read(&path).unwrap(), measured());
    let after = read_file(&path).unwrap();
    let actual = after.tag(TagType::Id3v2).unwrap();
    for item in tag.items() {
        assert!(
            actual.items().any(|candidate| candidate == item),
            "{item:?}"
        );
    }
    assert_eq!(actual.get_items(ItemKey::OriginalReleaseDate).count(), 1);
    assert_eq!(
        audio,
        rodio::Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .collect::<Vec<_>>()
    );
    assert!(remove(&path).unwrap());
    let restored = read_file(&path).unwrap();
    verify_tag_items(tag, restored.tag(TagType::Id3v2).unwrap()).unwrap();
}

#[test]
fn replay_gain_preserves_id3_url_frames() {
    use lofty::tag::{ItemValue, TagItem};

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("urls.mp3");
    fs::write(&path, include_bytes!("../../../../../fixtures/silence.mp3")).unwrap();
    let mut tag = Tag::new(TagType::Id3v2);
    for key in [
        ItemKey::TrackArtistUrl,
        ItemKey::AudioFileUrl,
        ItemKey::CopyrightUrl,
    ] {
        tag.push(TagItem::new(
            key,
            ItemValue::Locator("https://example.com/".into()),
        ));
    }
    let native = lofty::id3::v2::Id3v2Tag::from(tag);
    native.save_to_path(&path, WriteOptions::default()).unwrap();
    let before = read_file(&path).unwrap();
    let audio: Vec<_> = rodio::Decoder::try_from(File::open(&path).unwrap())
        .unwrap()
        .collect();
    assert!(write(&path, measured(), true).unwrap());
    assert_eq!(read(&path).unwrap(), measured());
    assert!(remove(&path).unwrap());
    let after = read_file(&path).unwrap();
    let expected = before.tag(TagType::Id3v2).unwrap();
    let actual = after.tag(TagType::Id3v2).unwrap();
    assert_eq!(expected.items().count(), actual.items().count());
    verify_tag_items(expected, actual).unwrap();
    assert_eq!(
        audio,
        rodio::Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .collect::<Vec<_>>()
    );
}

#[test]
fn tiny_raw_aac_is_not_replaced_when_its_decoder_verification_fails() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tiny.aac");
    let bytes = include_bytes!("../../../../../fixtures/silence.aac");
    fs::write(&path, bytes).unwrap();
    assert!(write(&path, measured(), true).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn wav_keeps_riff_metadata_album_gain_custom_fields_and_pictures() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("track.wav");
    crate::fixtures::wave(&path, 0.1);
    let mut riff = Tag::new(TagType::RiffInfo);
    riff.insert_text(ItemKey::TrackTitle, "Title".to_owned());
    riff.save_to_path(&path, WriteOptions::default()).unwrap();
    let mut id3 = Tag::new(TagType::Id3v2);
    id3.insert_text(ItemKey::Comment, "Keep me".to_owned());
    id3.insert_text(ItemKey::ReplayGainAlbumGain, "-5.00 dB".to_owned());
    let picture = lofty::picture::Picture::from_reader(
        &mut File::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/cover.png")).unwrap(),
    )
    .unwrap();
    id3.push_picture(picture);
    let mut native = lofty::id3::v2::Id3v2Tag::from(id3.clone());
    native.insert_user_text("CUSTOM".to_owned(), "Custom value".to_owned());
    native.save_to_path(&path, WriteOptions::default()).unwrap();
    write(&path, measured(), true).unwrap();
    let after = read_file(&path).unwrap();
    assert_eq!(
        after
            .tag(TagType::RiffInfo)
            .unwrap()
            .get_string(ItemKey::TrackTitle),
        Some("Title")
    );
    let tag = after.tag(TagType::Id3v2).unwrap();
    assert_eq!(tag.get_string(ItemKey::Comment), Some("Keep me"));
    assert_eq!(
        tag.get_string(ItemKey::ReplayGainAlbumGain),
        Some("-5.00 dB")
    );
    use lofty::file::AudioFile;
    let native = lofty::iff::wav::WavFile::read_from(
        &mut File::open(&path).unwrap(),
        ParseOptions::default(),
    )
    .unwrap();
    assert_eq!(
        native.id3v2().unwrap().get_user_text("CUSTOM"),
        Some("Custom value")
    );
    assert_eq!(tag.pictures(), id3.pictures());
    let audio: Vec<_> = rodio::Decoder::try_from(File::open(&path).unwrap())
        .unwrap()
        .collect();
    assert!(remove(&path).unwrap());
    let restored = read_file(&path).unwrap();
    assert!(restored
        .tags()
        .iter()
        .all(|tag| tag.items().all(|item| !is_replay_gain(item.key()))));
    assert_eq!(
        restored
            .tag(TagType::RiffInfo)
            .unwrap()
            .get_string(ItemKey::TrackTitle),
        Some("Title")
    );
    let tag = restored.tag(TagType::Id3v2).unwrap();
    assert_eq!(tag.get_string(ItemKey::Comment), Some("Keep me"));
    assert_eq!(tag.pictures(), id3.pictures());
    let native = lofty::iff::wav::WavFile::read_from(
        &mut File::open(&path).unwrap(),
        ParseOptions::default(),
    )
    .unwrap();
    assert_eq!(
        native.id3v2().unwrap().get_user_text("CUSTOM"),
        Some("Custom value")
    );
    assert_eq!(
        audio,
        rodio::Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .collect::<Vec<_>>()
    );
}

#[test]
fn filling_partial_tags_preserves_valid_values_but_force_replaces_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("partial.wav");
    crate::fixtures::wave(&path, 0.1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::ReplayGainTrackPeak, "0.50000000".to_owned());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert!(write(&path, measured(), false).unwrap());
    assert_eq!(
        read(&path).unwrap(),
        TrackGain {
            gain_db: Some(-6.0),
            peak: Some(0.5)
        }
    );
    assert!(write(&path, measured(), true).unwrap());
    assert_eq!(read(&path).unwrap(), measured());
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::ReplayGainTrackGain, "-12.00 dB".to_owned());
    tag.insert_text(ItemKey::ReplayGainTrackPeak, "NaN".to_owned());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    assert!(write(&path, measured(), false).unwrap());
    assert_eq!(
        read(&path).unwrap(),
        TrackGain {
            gain_db: Some(-12.0),
            peak: Some(0.8)
        }
    );
}
