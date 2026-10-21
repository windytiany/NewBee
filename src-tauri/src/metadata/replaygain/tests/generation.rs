use super::*;

#[test]
fn measures_relative_loudness_without_changing_audio_and_reuses_complete_tags() {
    let dir = tempfile::tempdir().unwrap();
    let quiet = dir.path().join("quiet.wav");
    let loud = dir.path().join("loud.wav");
    wave(&quiet, 0.1);
    wave(&loud, 0.4);
    let before = samples(&quiet);
    assert!(generate(&quiet, true).unwrap());
    assert!(generate(&loud, true).unwrap());
    let a = replaygain::read(&quiet).unwrap();
    let b = replaygain::read(&loud).unwrap();
    assert!((a.gain_db.unwrap() - b.gain_db.unwrap() - 12.04).abs() < 0.1);
    assert!((a.peak.unwrap() - 0.1).abs() < 0.005);
    assert_eq!(before, samples(&quiet));
    let bytes = fs::read(&quiet).unwrap();
    assert!(!generate(&quiet, false).unwrap());
    assert_eq!(bytes, fs::read(&quiet).unwrap());
    replaygain::write(
        &quiet,
        TrackGain {
            gain_db: Some(-40.0),
            peak: Some(0.5),
        },
        true,
    )
    .unwrap();
    assert!(generate(&quiet, true).unwrap());
    assert_eq!(a, replaygain::read(&quiet).unwrap());
}

#[test]
fn silence_has_finite_tags_and_a_readonly_or_invalid_file_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("silence.wav");
    wave(&path, 0.0);
    generate(&path, true).unwrap();
    assert_eq!(
        replaygain::read(&path).unwrap(),
        TrackGain {
            gain_db: Some(0.0),
            peak: Some(0.0)
        }
    );
    let before = fs::read(&path).unwrap();
    let original_permissions = fs::metadata(&path).unwrap().permissions();
    let mut permissions = original_permissions.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(!generate(&path, false).unwrap());
    assert!(generate(&path, true).unwrap_err().contains("只读"));
    assert_eq!(before, fs::read(&path).unwrap());
    // Restore the original permissions so TempDir can clean up on Windows.
    fs::set_permissions(&path, original_permissions).unwrap();
    let invalid = dir.path().join("invalid.mp3");
    fs::write(&invalid, b"not audio").unwrap();
    assert!(generate(&invalid, true).is_err());
    assert_eq!(fs::read(&invalid).unwrap(), b"not audio");
}

#[test]
fn below_gate_and_short_audio_use_neutral_gain_and_keep_measured_peak() {
    let dir = tempfile::tempdir().unwrap();
    for (name, amplitude, short) in [("quiet.wav", 0.0001, false), ("short.wav", 0.1, true)] {
        let path = dir.path().join(name);
        wave(&path, amplitude);
        if short {
            let mut bytes = fs::read(&path).unwrap();
            bytes.truncate(44 + 4410 * 2);
            bytes[4..8].copy_from_slice(&(36_u32 + 4410 * 2).to_le_bytes());
            bytes[40..44].copy_from_slice(&(4410_u32 * 2).to_le_bytes());
            fs::write(&path, bytes).unwrap();
        }
        let before = samples(&path);
        let measurement = measurement::measure(&path).unwrap();
        assert_eq!(measurement.loudness, f64::NEG_INFINITY);
        assert!(measurement.peak > 0.0);
        assert!(generate(&path, true).unwrap());
        let gain = replaygain::read(&path).unwrap();
        assert_eq!(gain.gain_db, Some(0.0));
        assert!((gain.peak.unwrap() - measurement.peak).abs() < 0.000001);
        assert_eq!(before, samples(&path));
        assert!(!generate(&path, false).unwrap());
    }
}

#[test]
fn batch_forces_overwrite_deduplicates_and_continues_after_failure() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("track.wav");
    wave(&path, 0.1);
    let database = crate::database::Database::open(":memory:").unwrap();
    let registration =
        crate::tracks::register(&database, &[path.to_string_lossy().into_owned()]).unwrap();
    let id = match &registration[0] {
        crate::tracks::model::TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("Registration failed"),
    };
    let mut progress = Vec::new();
    let results =
        commands::analyze_tracks(&database, vec![i64::MAX, id, id], Vec::new(), |value| {
            progress.push(value)
        });
    let values = serde_json::to_value(results).unwrap();
    assert_eq!(values.as_array().unwrap().len(), 2);
    assert!(values[0]["error"].is_string());
    assert_eq!(values[1]["fileWritten"], true);
    assert_eq!(values[1]["databaseUpdated"], true);
    assert_eq!(progress.len(), 3);
    assert!(replaygain::read(&path).unwrap().complete());
}

#[test]
fn temporary_file_analysis_writes_tags_without_registering_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("temporary.wav");
    wave(&path, 0.1);
    let database = crate::database::Database::open(":memory:").unwrap();
    let paths = vec![path.to_string_lossy().into_owned(); 2];
    let results = commands::analyze_tracks(&database, Vec::new(), paths, |_| {});
    let values = serde_json::to_value(results).unwrap();
    assert_eq!(values.as_array().unwrap().len(), 1);
    assert!(values[0]["trackId"].is_null());
    assert_eq!(values[0]["fileWritten"], true);
    assert!(values[0]["error"].is_null());
    let count: i64 = database
        .connection()
        .unwrap()
        .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
    assert!(replaygain::read(&path).unwrap().complete());
}

#[test]
#[ignore = "requires NEWBEE_REPLAYGAIN_REPRO_FILE pointing to a local audio file"]
fn analyzes_local_file_without_changing_source() {
    let source =
        std::path::PathBuf::from(std::env::var_os("NEWBEE_REPLAYGAIN_REPRO_FILE").unwrap());
    let original = fs::read(&source).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(source.file_name().unwrap());
    fs::copy(&source, &path).unwrap();
    let result = generate(&path, true);
    assert_eq!(fs::read(&source).unwrap(), original);
    assert!(result.is_ok(), "{result:?}");
    let gain = replaygain::read(&path).unwrap();
    assert_eq!(gain.gain_db, Some(0.0));
    assert!(gain.complete());
}

#[test]
fn analysis_keeps_the_decoder_duration() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("track.wav");
    wave(&path, 0.1);
    let duration = Decoder::try_from(File::open(&path).unwrap())
        .unwrap()
        .total_duration();
    generate(&path, true).unwrap();
    assert_eq!(
        duration,
        Decoder::try_from(File::open(&path).unwrap())
            .unwrap()
            .total_duration()
    );
}
