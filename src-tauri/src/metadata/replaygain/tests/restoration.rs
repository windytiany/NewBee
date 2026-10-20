use super::*;

#[test]
fn restores_registered_and_temporary_files_deduplicates_and_continues_after_failure() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registered.wav");
    let temporary = dir.path().join("temporary.wav");
    wave(&path, 0.1);
    wave(&temporary, 0.2);
    for path in [&path, &temporary] {
        replaygain::write(
            path,
            TrackGain {
                gain_db: Some(-6.0),
                peak: Some(0.5),
            },
            true,
        )
        .unwrap();
    }
    let before = samples(&path);
    let database = crate::database::Database::open(":memory:").unwrap();
    let registration =
        crate::tracks::register(&database, &[path.to_string_lossy().into_owned()]).unwrap();
    let id = match &registration[0] {
        crate::tracks::model::TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("Registration failed"),
    };
    let mut progress = Vec::new();
    let results = commands::restore_tracks(
        &database,
        vec![i64::MAX, id, id],
        vec![
            path.to_string_lossy().into_owned(),
            temporary.to_string_lossy().into_owned(),
            temporary.to_string_lossy().into_owned(),
        ],
        |value| progress.push(value),
    );
    let values = serde_json::to_value(results).unwrap();
    assert_eq!(values.as_array().unwrap().len(), 3);
    assert!(values[0]["error"].is_string());
    assert_eq!(values[1]["fileWritten"], true);
    assert_eq!(values[1]["databaseUpdated"], true);
    assert!(values[1]["error"].is_null());
    assert!(values[2]["trackId"].is_null());
    assert_eq!(values[2]["fileWritten"], true);
    assert_eq!(values[2]["databaseUpdated"], false);
    assert!(values[2]["error"].is_null());
    let progress = serde_json::to_value(progress).unwrap();
    assert_eq!(
        progress,
        serde_json::json!([
            { "completed": 0, "total": 3 },
            { "completed": 1, "total": 3 },
            { "completed": 2, "total": 3 },
            { "completed": 3, "total": 3 },
        ])
    );
    assert_eq!(replaygain::read(&path).unwrap(), TrackGain::default());
    assert_eq!(replaygain::read(&temporary).unwrap(), TrackGain::default());
    assert_eq!(before, samples(&path));
    let count: i64 = database
        .connection()
        .unwrap()
        .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
    let bytes = fs::read(&path).unwrap();
    let results = commands::restore_tracks(
        &database,
        vec![id],
        vec![temporary.to_string_lossy().into_owned()],
        |_| {},
    );
    let values = serde_json::to_value(results).unwrap();
    assert_eq!(values[0]["fileWritten"], false);
    assert_eq!(values[0]["databaseUpdated"], true);
    assert!(values[0]["error"].is_null());
    assert_eq!(values[1]["fileWritten"], false);
    assert!(values[1]["error"].is_null());
    assert_eq!(bytes, fs::read(&path).unwrap());
}
