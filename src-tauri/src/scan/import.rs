use super::{
    has_supported_extension, import_track, record_failure, Database, ScanResult, ScanState,
};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub async fn import_music_files(
    paths: Vec<String>,
    app: tauri::AppHandle,
    scan_state: State<'_, ScanState>,
) -> Result<ScanResult, String> {
    let guard = scan_state.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = guard;
        use tauri::Manager;
        let database = app.state::<Database>();
        run_import(&database, &paths)
    })
    .await
    .map_err(|error| format!("Music file import task failed: {error}"))
}

fn run_import(database: &Database, paths: &[String]) -> ScanResult {
    let mut result = ScanResult::default();
    let mut visited = HashSet::new();
    for path in paths {
        let path = Path::new(path);
        if !has_supported_extension(path) {
            result.skipped += 1;
            continue;
        }
        let canonical = match fs::canonicalize(path) {
            Ok(canonical) if canonical.is_file() => canonical,
            Ok(_) => {
                record_failure(&mut result, path, "selected path is not a file");
                continue;
            }
            Err(error) => {
                record_failure(&mut result, path, &error.to_string());
                continue;
            }
        };
        if !visited.insert(canonical.clone()) {
            result.skipped += 1;
            continue;
        }
        import_track(database, &canonical, &mut result);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestFiles(PathBuf);

    impl TestFiles {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!(
                "newbee-file-import-{}-{}",
                std::process::id(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir(&directory).unwrap();
            Self(directory)
        }

        fn wav(&self, name: &str) -> String {
            // One second of unsigned 8-bit mono PCM at 8 kHz.
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&8036_u32.to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16_u32.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&8000_u32.to_le_bytes());
            bytes.extend_from_slice(&8000_u32.to_le_bytes());
            bytes.extend_from_slice(&1_u16.to_le_bytes());
            bytes.extend_from_slice(&8_u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&8000_u32.to_le_bytes());
            bytes.extend_from_slice(&[128; 8000]);
            self.write(name, &bytes)
        }

        fn write(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        }
    }

    impl Drop for TestFiles {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn imports_multiple_files_and_preserves_original_locations() {
        let files = TestFiles::new();
        let first = files.wav("中文.wav");
        let second = files.wav("日本語.WAV");
        let database = Database::open(":memory:").unwrap();
        let result = run_import(&database, &[first.clone(), second.clone()]);
        assert_eq!(
            (result.added, result.updated, result.skipped, result.failed),
            (2, 0, 0, 0)
        );
        for (id, path) in [(1, first), (2, second)] {
            let track = database.get_track(id).unwrap().unwrap();
            assert_eq!(
                track.path(),
                fs::canonicalize(&path).unwrap().to_string_lossy()
            );
            assert!(Path::new(&path).is_file());
            let metadata = serde_json::to_value(track).unwrap();
            assert_eq!(metadata["sampleRateHz"], 8000);
            assert_eq!(metadata["channels"], 1);
            assert_eq!(metadata["durationMs"], 1000);
        }
        assert!(database
            .list_music_library_directories()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn skips_duplicate_selections_and_updates_existing_tracks_without_changing_ids() {
        let files = TestFiles::new();
        let path = files.wav("song.wav");
        let database = Database::open(":memory:").unwrap();
        let result = run_import(&database, &[path.clone(), path.clone()]);
        assert_eq!((result.added, result.skipped), (1, 1));
        let playlist = database.create_playlist("playlist").unwrap();
        database.add_track_to_playlist(playlist, 1).unwrap();
        let result = run_import(&database, &[path]);
        assert_eq!((result.added, result.updated), (0, 1));
        assert!(database.get_track(1).unwrap().is_some());
        assert!(database.get_track(2).unwrap().is_none());
        assert_eq!(
            serde_json::to_value(database.list_playlist_tracks(playlist).unwrap()).unwrap()[0]
                ["trackId"],
            1
        );
    }

    #[test]
    fn continues_after_unsupported_missing_corrupt_and_directory_inputs() {
        let files = TestFiles::new();
        let unsupported = files.write("notes.txt", b"not audio");
        let corrupt = files.write("corrupt.mp3", b"not audio");
        let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
        let directory = files.0.join("folder.wav");
        fs::create_dir(&directory).unwrap();
        let valid = files.wav("valid.wav");
        let database = Database::open(":memory:").unwrap();
        let result = run_import(
            &database,
            &[
                unsupported,
                corrupt,
                missing,
                directory.to_string_lossy().into_owned(),
                valid,
            ],
        );
        assert_eq!(
            (result.added, result.updated, result.skipped, result.failed),
            (1, 0, 1, 3)
        );
    }

    #[test]
    fn empty_selection_does_not_change_the_library() {
        let database = Database::open(":memory:").unwrap();
        let result = run_import(&database, &[]);
        assert_eq!(
            (result.added, result.updated, result.skipped, result.failed),
            (0, 0, 0, 0)
        );
        assert!(database.get_track(1).unwrap().is_none());
    }

    #[test]
    fn exposes_the_same_extensions_used_for_backend_validation() {
        for extension in super::super::supported_audio_extensions() {
            assert!(has_supported_extension(Path::new(&format!(
                "song.{extension}"
            ))));
            assert!(has_supported_extension(Path::new(&format!(
                "song.{}",
                extension.to_ascii_uppercase()
            ))));
        }
        assert!(!has_supported_extension(Path::new("song.opus")));
        assert!(!has_supported_extension(Path::new("song")));
    }

    #[test]
    fn scan_and_import_share_an_exclusive_guard_that_releases_on_drop() {
        let state = ScanState::default();
        let guard = state.acquire().unwrap();
        assert!(state.acquire().is_err());
        drop(guard);
        assert!(state.acquire().is_ok());
    }
}
