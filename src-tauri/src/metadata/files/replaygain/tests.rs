use super::*;
use lofty::{config::WriteOptions, prelude::TagExt};

fn measured() -> TrackGain {
    TrackGain {
        gain_db: Some(-6.0),
        peak: Some(0.8),
    }
}

#[test]
fn parses_units_and_rejects_invalid_values_without_unsafe_amplification() {
    assert_eq!(gain(" +3.25 dB "), Some(3.25));
    assert_eq!(gain("-9.5 DB"), Some(-9.5));
    assert_eq!(gain("2"), Some(2.0));
    for value in ["NaN", "inf", "-inf", "1000 dB", "abc", "🦀", "3 dB junk"] {
        assert_eq!(gain(value), None, "{value}");
    }
    assert_eq!(TrackGain::default().amplitude(0.0), 1.0);
    assert_eq!(
        TrackGain {
            gain_db: Some(6.0),
            peak: None
        }
        .amplitude(0.0),
        1.0
    );
    assert_eq!(
        TrackGain {
            gain_db: Some(20.0),
            peak: Some(0.5)
        }
        .amplitude(0.0),
        2.0
    );
    assert!((measured().amplitude(0.0) - 0.5011872).abs() < 0.00001);
    assert_eq!(
        TrackGain {
            gain_db: None,
            peak: Some(2.0)
        }
        .amplitude(0.0),
        1.0
    );
}

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
fn tiny_raw_aac_is_not_replaced_when_its_decoder_verification_fails() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tiny.aac");
    let bytes = include_bytes!("../../../../fixtures/silence.aac");
    fs::write(&path, bytes).unwrap();
    assert!(write(&path, measured(), true).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn wav_keeps_riff_metadata_album_gain_custom_fields_and_pictures() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("track.wav");
    crate::loudness::tests::support::wave(&path, 0.1);
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
    crate::loudness::tests::support::wave(&path, 0.1);
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

#[test]
fn removes_track_and_album_tags_from_all_supported_formats_without_changing_audio() {
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
        let audio: Vec<_> = rodio::Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .collect();
        write(&path, measured(), true).unwrap();
        let original = read_file(&path).unwrap();
        let mut tag = original.tag(preferred_type(&original)).unwrap().clone();
        tag.insert_text(ItemKey::ReplayGainAlbumGain, "-3.00 dB".to_owned());
        tag.insert_text(ItemKey::ReplayGainAlbumPeak, "0.95".to_owned());
        tag.insert_text(ItemKey::TrackTitle, "Keep title".to_owned());
        tag.save_to_path(&path, WriteOptions::default()).unwrap();
        assert!(remove(&path).unwrap(), "{fixture}");
        assert_eq!(read(&path).unwrap(), TrackGain::default(), "{fixture}");
        let restored = read_file(&path).unwrap();
        assert!(
            restored
                .tags()
                .iter()
                .all(|tag| tag.items().all(|item| !is_replay_gain(item.key()))),
            "{fixture}"
        );
        assert_eq!(
            restored
                .tag(preferred_type(&restored))
                .unwrap()
                .get_string(ItemKey::TrackTitle),
            Some("Keep title"),
            "{fixture}"
        );
        assert_eq!(
            audio,
            rodio::Decoder::try_from(File::open(&path).unwrap())
                .unwrap()
                .collect::<Vec<_>>(),
            "{fixture}"
        );
        let bytes = fs::read(&path).unwrap();
        assert!(!remove(&path).unwrap());
        assert_eq!(bytes, fs::read(&path).unwrap());
    }
}

#[test]
fn removes_malformed_partial_tags_but_readonly_and_invalid_files_are_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("partial.wav");
    crate::loudness::tests::support::wave(&path, 0.1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::ReplayGainTrackGain, "invalid gain".to_owned());
    tag.insert_text(ItemKey::ReplayGainAlbumPeak, "NaN".to_owned());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let bytes = fs::read(&path).unwrap();
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut readonly = permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    assert!(remove(&path).unwrap_err().contains("只读"));
    assert_eq!(bytes, fs::read(&path).unwrap());
    fs::set_permissions(&path, permissions).unwrap();
    assert!(remove(&path).unwrap());
    assert!(!read_file(&path)
        .unwrap()
        .tags()
        .iter()
        .any(|tag| tag.items().any(|item| is_replay_gain(item.key()))));
    let invalid = dir.path().join("invalid.mp3");
    fs::write(&invalid, b"not audio").unwrap();
    assert!(remove(&invalid).is_err());
    assert_eq!(fs::read(&invalid).unwrap(), b"not audio");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}
