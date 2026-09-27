use crate::database::{
    Database, EmbeddedArtwork, MusicLibraryDirectory, ScannedTrack, TrackWriteOutcome,
};
use lofty::file::FileType;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

#[derive(Default)]
pub struct ScanState(Arc<AtomicBool>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    added: u64,
    updated: u64,
    skipped: u64,
    failed: u64,
}

struct ScanGuard(Arc<AtomicBool>);

impl Drop for ScanGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn scan_music_library(
    app: tauri::AppHandle,
    scan_state: State<'_, ScanState>,
) -> Result<ScanResult, String> {
    scan_state
        .0
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "A music library scan is already running".to_owned())?;

    let scan_flag = Arc::clone(&scan_state.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _scan_guard = ScanGuard(scan_flag);
        use tauri::Manager;
        let database = app.state::<Database>();
        run_scan(&database)
    })
    .await
    .map_err(|error| format!("Music library scan task failed: {error}"))?
}

fn run_scan(database: &Database) -> Result<ScanResult, String> {
    let directories = database.list_music_library_directories()?;
    let mut result = ScanResult {
        added: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
    };
    let mut visited_directories = HashSet::new();
    let mut visited_files = HashSet::new();

    for directory in directories {
        scan_directory(
            database,
            &directory,
            &mut visited_directories,
            &mut visited_files,
            &mut result,
        );
    }

    Ok(result)
}

fn scan_directory(
    database: &Database,
    directory: &MusicLibraryDirectory,
    visited_directories: &mut HashSet<PathBuf>,
    visited_files: &mut HashSet<PathBuf>,
    result: &mut ScanResult,
) {
    let configured_path = PathBuf::from(&directory.path);
    let root = match fs::canonicalize(&configured_path) {
        Ok(root) if root == configured_path => root,
        Ok(_) => {
            record_failure(
                result,
                &configured_path,
                "saved directory now resolves through a link",
            );
            return;
        }
        Err(error) => {
            record_failure(result, &configured_path, &error.to_string());
            return;
        }
    };

    if !root.is_dir() {
        record_failure(result, &root, "saved path is not a directory");
        return;
    }

    let mut pending_directories = vec![root.clone()];
    while let Some(path) = pending_directories.pop() {
        let canonical_path = match fs::canonicalize(&path) {
            Ok(canonical_path) if canonical_path == path && canonical_path.starts_with(&root) => {
                canonical_path
            }
            Ok(_) => {
                result.skipped += 1;
                continue;
            }
            Err(error) => {
                record_failure(result, &path, &error.to_string());
                continue;
            }
        };
        if !visited_directories.insert(canonical_path.clone()) {
            continue;
        }

        let entries = match fs::read_dir(&canonical_path) {
            Ok(entries) => entries,
            Err(error) => {
                record_failure(result, &path, &error.to_string());
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    record_failure(result, &path, &error.to_string());
                    continue;
                }
            };
            let entry_path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    record_failure(result, &entry_path, &error.to_string());
                    continue;
                }
            };

            if file_type.is_symlink() {
                result.skipped += 1;
            } else if file_type.is_dir() {
                pending_directories.push(entry_path);
            } else if file_type.is_file() {
                if !has_supported_extension(&entry_path) {
                    result.skipped += 1;
                    continue;
                }
                let canonical_file = match fs::canonicalize(&entry_path) {
                    Ok(canonical_file)
                        if canonical_file == entry_path && canonical_file.starts_with(&root) =>
                    {
                        canonical_file
                    }
                    Ok(_) => {
                        result.skipped += 1;
                        continue;
                    }
                    Err(error) => {
                        record_failure(result, &entry_path, &error.to_string());
                        continue;
                    }
                };
                if !visited_files.insert(canonical_file.clone()) {
                    result.skipped += 1;
                    continue;
                }

                match read_track(&canonical_file) {
                    Ok(Some(track)) => match database.upsert_scanned_track(&track) {
                        Ok(TrackWriteOutcome::Added) => result.added += 1,
                        Ok(TrackWriteOutcome::Updated) => result.updated += 1,
                        Err(error) => record_failure(result, &canonical_file, &error),
                    },
                    Ok(None) => result.skipped += 1,
                    Err(error) => record_failure(result, &canonical_file, &error),
                }
            } else {
                result.skipped += 1;
            }
        }
    }
}

fn has_supported_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("mp3" | "aac" | "m4a" | "ogg" | "oga" | "flac" | "wav")
    )
}

fn read_track(path: &Path) -> Result<Option<ScannedTrack>, String> {
    let tagged_file = Probe::open(path)
        .map_err(|error| error.to_string())?
        .guess_file_type()
        .map_err(|error| error.to_string())?
        .read()
        .map_err(|error| error.to_string())?;
    let file_type = tagged_file.file_type();
    if !is_supported_file_type(file_type) {
        return Ok(None);
    }

    let properties = tagged_file.properties();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    let (title, artist, album, album_artist, release_date, disc_number, track_number, artwork) =
        match tag {
            Some(tag) => (
                tag_text(tag, &ItemKey::TrackTitle),
                tag_text(tag, &ItemKey::TrackArtist),
                tag_text(tag, &ItemKey::AlbumTitle),
                tag_text(tag, &ItemKey::AlbumArtist),
                tag_text(tag, &ItemKey::ReleaseDate)
                    .or_else(|| tag_text(tag, &ItemKey::RecordingDate)),
                tag_number(tag, &ItemKey::DiscNumber),
                tag_number(tag, &ItemKey::TrackNumber),
                read_artwork(tag)?,
            ),
            None => (None, None, None, None, None, None, None, None),
        };

    let duration_ms = i64::try_from(properties.duration().as_millis())
        .ok()
        .filter(|duration| *duration > 0);

    Ok(Some(ScannedTrack {
        path: path.to_string_lossy().into_owned(),
        title,
        artist,
        album,
        album_artist,
        release_date,
        disc_number,
        track_number,
        duration_ms,
        codec: codec_for_file_type(file_type).map(str::to_owned),
        sample_rate_hz: properties.sample_rate().map(i64::from),
        bitrate_kbps: properties.audio_bitrate().map(i64::from),
        channels: properties.channels().map(i64::from),
        artwork,
    }))
}

fn is_supported_file_type(file_type: FileType) -> bool {
    matches!(
        file_type,
        FileType::Mpeg
            | FileType::Aac
            | FileType::Mp4
            | FileType::Vorbis
            | FileType::Flac
            | FileType::Wav
    )
}

fn codec_for_file_type(file_type: FileType) -> Option<&'static str> {
    match file_type {
        FileType::Mpeg => Some("MPEG Audio"),
        FileType::Aac => Some("AAC"),
        FileType::Vorbis => Some("Vorbis"),
        FileType::Flac => Some("FLAC"),
        FileType::Mp4 | FileType::Wav => None,
        _ => None,
    }
}

fn tag_text(tag: &Tag, key: &ItemKey) -> Option<String> {
    tag.get_string(key)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn tag_number(tag: &Tag, key: &ItemKey) -> Option<i64> {
    tag_text(tag, key)?.split('/').next()?.trim().parse().ok()
}

fn read_artwork(tag: &Tag) -> Result<Option<EmbeddedArtwork>, String> {
    let picture = tag
        .pictures()
        .iter()
        .find(|picture| picture.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first());
    let Some(picture) = picture else {
        return Ok(None);
    };
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .ok_or_else(|| "embedded artwork has no recognized MIME type".to_owned())?;

    Ok(Some(EmbeddedArtwork {
        mime_type,
        image: picture.data().to_vec(),
    }))
}

fn record_failure(result: &mut ScanResult, path: &Path, error: &str) {
    result.failed += 1;
    eprintln!("Failed to scan '{}': {error}", path.display());
}
