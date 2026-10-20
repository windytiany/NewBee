use super::super::directory::run_scan;
use crate::database::Database;
use crate::fixtures::TestFiles;
use std::time::Instant;

struct Timings;
static TIMINGS: Timings = Timings;

impl log::Log for Timings {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.target().starts_with("newbee_lib::library::import")
    }
    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            eprintln!("{}", record.args());
        }
    }
    fn flush(&self) {}
}

#[test]
#[ignore = "manual scan timing on an isolated database"]
fn measures_initial_import_and_unchanged_rescan() {
    let _ = log::set_logger(&TIMINGS);
    log::set_max_level(log::LevelFilter::Info);
    let files = TestFiles::new();
    let root = match std::env::var_os("NEWBEE_SCAN_BENCHMARK_ROOT") {
        Some(root) => std::fs::canonicalize(root).unwrap(),
        None => {
            for index in 0..128 {
                files.wav(&format!("{index}.wav"));
            }
            image::RgbImage::from_pixel(1024, 1024, image::Rgb([64, 128, 192]))
                .save(files.0.join("cover.png"))
                .unwrap();
            files.0.clone()
        }
    };
    let database = Database::open(files.0.join("benchmark.sqlite3")).unwrap();
    database
        .add_music_library_directory(&root.to_string_lossy())
        .unwrap();
    let start = Instant::now();
    let initial = run_scan(&database, |_, _| {}).unwrap();
    eprintln!(
        "initial_ms={} added={} failed={}",
        start.elapsed().as_millis(),
        initial.added,
        initial.failed
    );
    assert!(initial.added > 0);
    for _ in 0..3 {
        let start = Instant::now();
        let result = run_scan(&database, |_, _| {}).unwrap();
        eprintln!(
            "rescan_ms={} updated={} failed={}",
            start.elapsed().as_millis(),
            result.updated,
            result.failed
        );
        assert_eq!((result.added, result.updated), (0, 0));
    }
}
