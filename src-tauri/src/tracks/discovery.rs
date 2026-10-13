use std::{
    collections::HashSet,
    fs::{self, File},
    path::{Path, PathBuf},
};

#[cfg(test)]
#[path = "discovery/tests.rs"]
mod tests;

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
