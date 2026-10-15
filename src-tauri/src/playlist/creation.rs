use std::{collections::HashSet, path::Path};

#[derive(Debug, serde::Serialize)]
pub(crate) struct Directory {
    path: String,
    name: String,
}

fn directories(paths: Vec<String>) -> Result<Vec<Directory>, String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for input in paths {
        let path = Path::new(&input);
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("Cannot access '{input}': {error}"))?;
        if !canonical.is_dir() || !seen.insert(canonical.clone()) {
            continue;
        }
        let name = path
            .file_name()
            .or_else(|| canonical.file_name())
            .ok_or_else(|| format!("Directory has no playlist name: {input}"))?
            .to_string_lossy()
            .into_owned();
        result.push(Directory {
            path: canonical.to_string_lossy().into_owned(),
            name,
        });
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn playlist_directories(paths: Vec<String>) -> Result<Vec<Directory>, String> {
    tauri::async_runtime::spawn_blocking(move || directories(paths))
        .await
        .map_err(|error| format!("Playlist directory discovery task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_named_directories_in_input_order_and_ignores_files_and_duplicates() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("日本語");
        let nested = first.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let audio = root.path().join("song.wav");
        std::fs::write(&audio, b"audio").unwrap();
        let sources = directories(
            [&first, &audio, &first, &nested]
                .map(|path| path.to_string_lossy().into_owned())
                .to_vec(),
        )
        .unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].name, "日本語");
        assert_eq!(sources[1].name, "nested");
        assert_eq!(Path::new(&sources[0].path), first.canonicalize().unwrap());
    }

    #[test]
    fn rejects_unavailable_paths() {
        let root = tempfile::tempdir().unwrap();
        assert!(directories(vec![root
            .path()
            .join("missing")
            .to_string_lossy()
            .into_owned()])
        .unwrap_err()
        .contains("Cannot access"));
    }
}
