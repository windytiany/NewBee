use std::{
    collections::HashSet,
    fs::{self, File},
    path::{Path, PathBuf},
};

pub(crate) const SUPPORTED_AUDIO_EXTENSIONS: &[&str] =
    &["mp3", "aac", "m4a", "ogg", "oga", "flac", "wav"];

#[tauri::command]
pub fn supported_audio_extensions() -> Vec<&'static str> {
    SUPPORTED_AUDIO_EXTENSIONS.to_vec()
}

pub(crate) fn has_supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_AUDIO_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

pub(crate) struct Failure {
    pub(crate) path: String,
    pub(crate) error: String,
}

pub(crate) type DiscoveredFile = Result<String, Failure>;

fn failure(path: &Path, error: impl ToString) -> Failure {
    Failure {
        path: path.to_string_lossy().into_owned(),
        error: error.to_string(),
    }
}

/// Only checks path accessibility; tag or decoder failures are not discovery failures.
pub(crate) fn discover(paths: &[String]) -> Vec<DiscoveredFile> {
    let mut results = Vec::new();
    let mut files = HashSet::new();
    let mut directories = HashSet::new();
    let mut inputs = HashSet::new();
    for path in paths {
        if !inputs.insert(path) {
            continue;
        }
        let path = Path::new(path);
        let canonical = match fs::canonicalize(path) {
            Ok(path) => path,
            Err(error) => {
                results.push(Err(failure(path, error)));
                continue;
            }
        };
        if canonical.is_dir() {
            let mut discovered = Vec::new();
            collect_directory(&canonical, &mut directories, &mut discovered);
            discovered.sort_by(|left, right| left.0.cmp(&right.0));
            for (path, outcome) in discovered {
                match outcome {
                    Ok(()) => add_file(&path, &mut files, &mut results),
                    Err(error) => results.push(Err(failure(&path, error))),
                }
            }
        } else if has_supported_extension(&canonical) {
            add_file(&canonical, &mut files, &mut results);
        } else {
            results.push(Err(failure(path, "文件格式不支持播放")));
        }
    }
    results
}

fn add_file(path: &Path, seen: &mut HashSet<PathBuf>, results: &mut Vec<DiscoveredFile>) {
    let canonical = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) => {
            results.push(Err(failure(path, error)));
            return;
        }
    };
    if !seen.insert(canonical.clone()) {
        return;
    }
    let outcome = (|| {
        let file = File::open(&canonical).map_err(|error| failure(path, error))?;
        if !file
            .metadata()
            .map_err(|error| failure(path, error))?
            .is_file()
        {
            return Err(failure(path, "所选路径不是文件"));
        }
        Ok(canonical.to_string_lossy().into_owned())
    })();
    results.push(outcome);
}

fn collect_directory(
    path: &Path,
    seen: &mut HashSet<PathBuf>,
    results: &mut Vec<(PathBuf, Result<(), String>)>,
) {
    let canonical = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) => {
            results.push((path.to_owned(), Err(error.to_string())));
            return;
        }
    };
    if !seen.insert(canonical) {
        return;
    }
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => {
            results.push((path.to_owned(), Err(error.to_string())));
            return;
        }
    };
    let mut sorted = Vec::new();
    for entry in entries {
        match entry {
            Ok(entry) => sorted.push(entry.path()),
            Err(error) => results.push((path.to_owned(), Err(error.to_string()))),
        }
    }
    sorted.sort();
    for entry_path in sorted {
        match fs::metadata(&entry_path) {
            Ok(metadata) if metadata.is_dir() => collect_directory(&entry_path, seen, results),
            Ok(metadata) if metadata.is_file() && has_supported_extension(&entry_path) => {
                results.push((entry_path, Ok(())));
            }
            Ok(_) => {}
            Err(error) => results.push((entry_path, Err(error.to_string()))),
        }
    }
}

fn readable_files(paths: Vec<String>) -> Vec<String> {
    discover(&paths)
        .into_iter()
        .filter_map(Result::ok)
        .collect()
}

#[tauri::command]
pub(crate) async fn readable_audio_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || readable_files(paths))
        .await
        .map_err(|error| format!("Audio file discovery task failed: {error}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DropPreview {
    has_files: bool,
    has_directories: bool,
}

fn preview_paths(paths: Vec<String>) -> DropPreview {
    let mut preview = DropPreview {
        has_files: false,
        has_directories: false,
    };
    for input in paths {
        let path = std::path::Path::new(&input);
        if path.is_dir() {
            preview.has_directories |= std::fs::read_dir(path).is_ok();
        } else if has_supported_extension(path) {
            preview.has_files |= std::fs::File::open(path)
                .and_then(|file| file.metadata())
                .is_ok_and(|metadata| metadata.is_file());
        }
        if preview.has_files && preview.has_directories {
            break;
        }
    }
    preview
}

#[tauri::command]
pub(crate) async fn preview_local_drop(paths: Vec<String>) -> Result<DropPreview, String> {
    tauri::async_runtime::spawn_blocking(move || preview_paths(paths))
        .await
        .map_err(|error| format!("Drop preview task failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{preview_paths, readable_files};
    use crate::fixtures::TestFiles;
    use std::path::Path;

    #[test]
    fn previews_directories_without_searching_for_audio_or_reading_tags() {
        let files = TestFiles::new();
        let empty = files.0.join("empty");
        std::fs::create_dir(&empty).unwrap();
        let preview = preview_paths(vec![empty.to_string_lossy().into_owned()]);
        assert!(preview.has_directories);
        assert!(!preview.has_files);

        let broken = files.write("broken.mp3", b"not audio");
        let unsupported = files.wav("unsupported.opus");
        let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
        let preview = preview_paths(vec![broken, unsupported.clone(), missing.clone()]);
        assert!(preview.has_files);
        assert!(!preview.has_directories);
        let preview = preview_paths(vec![unsupported, missing]);
        assert!(!preview.has_files);
        assert!(!preview.has_directories);
    }

    #[test]
    fn discovers_accessible_files_and_directories_without_requiring_readable_tags() {
        let files = TestFiles::new();
        let first = files.wav("first.WAV");
        let last = files.wav("last.wav");
        let unsupported = files.wav("unsupported.opus");
        let broken = files.write("broken.mp3", b"not audio");
        let missing = files.0.join("missing.wav").to_string_lossy().into_owned();
        let directory = files.0.join("folder.wav");
        std::fs::create_dir(&directory).unwrap();
        let nested = files.wav("folder.wav/nested.wav");
        let expected: Vec<_> = [&first, &broken, &nested, &last]
            .into_iter()
            .map(|path| {
                Path::new(path)
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(
            readable_files(vec![
                first,
                unsupported,
                broken,
                missing,
                directory.to_string_lossy().into_owned(),
                last,
            ]),
            expected
        );
    }

    use super::{has_supported_extension, supported_audio_extensions};

    #[test]
    fn exposes_the_same_extensions_used_for_backend_validation() {
        for extension in supported_audio_extensions() {
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
}
