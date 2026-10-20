use super::*;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

#[test]
#[ignore = "manual loudness timing on a local audio copy"]
fn analyzes_song_within_interactive_budget() {
    let input = PathBuf::from(
        std::env::var_os("NEWBEE_LOUDNESS_SAMPLE")
            .expect("Set NEWBEE_LOUDNESS_SAMPLE to a local audio file"),
    );
    let budget_ms = std::env::var("NEWBEE_LOUDNESS_BUDGET_MS")
        .unwrap_or_else(|_| "3000".to_owned())
        .parse::<u64>()
        .unwrap();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join(input.file_name().unwrap());
    fs::copy(&input, &path).unwrap();
    let database = crate::database::Database::open(":memory:").unwrap();
    let registration =
        crate::tracks::register(&database, &[path.to_string_lossy().into_owned()]).unwrap();
    let id = match &registration[0] {
        crate::tracks::model::TrackRegistrationResult::Registered { track, .. } => track.id,
        _ => panic!("Registration failed"),
    };
    let started = Instant::now();
    let results = commands::analyze_tracks(&database, vec![id], Vec::new(), |_| {});
    let elapsed = started.elapsed();
    let result = serde_json::to_value(&results).unwrap();
    eprintln!(
        "loudness elapsed_ms={} result={result}",
        elapsed.as_millis()
    );
    assert_eq!(result[0]["error"], serde_json::Value::Null, "{result}");
    assert_eq!(result[0]["fileWritten"], true);
    assert_eq!(result[0]["databaseUpdated"], true);
    let gain = replaygain::read(&path).unwrap();
    eprintln!(
        "loudness elapsed_ms={} gain_db={:?} peak={:?}",
        elapsed.as_millis(),
        gain.gain_db,
        gain.peak
    );
    assert!(
        elapsed < Duration::from_millis(budget_ms),
        "Loudness analysis took {} ms, budget is {budget_ms} ms",
        elapsed.as_millis()
    );
}
