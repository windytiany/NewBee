use super::*;

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
    crate::fixtures::wave(&path, 0.1);
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
