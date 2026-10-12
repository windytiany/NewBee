use super::FileTrack;
use crate::locking::write::WriteState;
use crate::metadata::{
    model::{normalize_changes, CoverRequest, MetadataChange, MetadataField},
    save::CoverUpdate,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{ipc::Channel, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditableFile {
    track: FileTrack,
    lyrics: Option<String>,
    no_lyrics: bool,
    writable_fields: Vec<MetadataField>,
    values: std::collections::HashMap<MetadataField, String>,
    issue: Option<String>,
}

fn editable(path: &str) -> Result<EditableFile, String> {
    let mut track = FileTrack::read(path)?;
    let editing = track
        .snapshot
        .editing
        .take()
        .ok_or_else(|| "缺少文件编辑信息".to_owned())?;
    Ok(EditableFile {
        lyrics: track.snapshot.lyrics.clone(),
        no_lyrics: false,
        writable_fields: editing.writable_fields,
        values: editing.values,
        issue: editing.issue,
        track,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSaveResult {
    track_id: String,
    path: String,
    file_written: bool,
    database_updated: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FilePatch {
    path: String,
    changes: Vec<MetadataChange>,
    write_cover: bool,
}

fn save_file(patch: &FilePatch, cover: Option<&CoverUpdate>) -> FileSaveResult {
    let action = cover.map(|cover| match &cover.picture {
        Some(picture) => super::CoverAction::Replace(picture),
        None => super::CoverAction::Delete,
    });
    let outcome = if patch.changes.is_empty() && action.is_none() {
        Ok(())
    } else {
        super::write_file_with_cover(Path::new(&patch.path), &patch.changes, action)
    };
    if let Err(error) = &outcome {
        log::warn!(
            "event=file_metadata_save_failed path={:?} error={error}",
            patch.path
        );
    } else {
        log::info!(
            "event=file_metadata_saved path={:?} fileWritten=true databaseUpdated=false",
            patch.path
        );
    }
    FileSaveResult {
        track_id: patch.path.clone(),
        path: patch.path.clone(),
        file_written: outcome.is_ok(),
        database_updated: false,
        error: outcome.err(),
    }
}

#[tauri::command]
pub(crate) async fn read_audio_file(path: String) -> Result<FileTrack, String> {
    tauri::async_runtime::spawn_blocking(move || FileTrack::read(&path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_editable_files(paths: Vec<String>) -> Result<Vec<EditableFile>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|path| editable(path)).collect())
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn save_file_metadata(
    mut patches: Vec<FilePatch>,
    cover: Option<CoverRequest>,
    on_progress: Channel<FileSaveResult>,
    operation_id: Option<String>,
    write: State<'_, WriteState>,
) -> Result<Vec<FileSaveResult>, String> {
    if patches.is_empty() {
        return Err("没有可编辑的文件".to_owned());
    }
    let mut seen = std::collections::HashSet::new();
    for patch in &mut patches {
        if !Path::new(&patch.path).is_absolute() || !seen.insert(patch.path.clone()) {
            return Err("无效或重复的文件目标".to_owned());
        }
        if patch.changes.is_empty() && !patch.write_cover {
            return Err("文件没有改动".to_owned());
        }
        if patch.write_cover && cover.is_none() {
            return Err("封面尚未下载".to_owned());
        }
        if !patch.changes.is_empty() {
            normalize_changes(&mut patch.changes)?;
        }
    }
    let guard = write.acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::logging::with_operation(operation_id, || {
            let _guard = guard;
            let cover = cover.map(CoverRequest::prepare).transpose()?;
            Ok(patches
                .iter()
                .map(|patch| {
                    let result = save_file(
                        patch,
                        if patch.write_cover {
                            cover.as_ref()
                        } else {
                            None
                        },
                    );
                    if let Err(error) = on_progress.send(result.clone()) {
                        log::warn!("File metadata progress failed: {error}");
                    }
                    result
                })
                .collect())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{database::Database, library::import::tests::support::TestFiles};

    #[test]
    fn file_save_does_not_touch_library_snapshots_and_reports_partial_results() {
        let files = TestFiles::new();
        let path = std::fs::canonicalize(files.wav("track.wav"))
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let database = Database::open(":memory:").unwrap();
        crate::library::import::import_track(&database, Path::new(&path), &mut Default::default());
        let patch = FilePatch {
            path: path.clone(),
            changes: vec![MetadataChange {
                field: MetadataField::Title,
                value: Some("Inbox title".into()),
                values: Vec::new(),
            }],
            write_cover: false,
        };
        let saved = save_file(&patch, None);
        assert!(saved.file_written);
        assert!(!saved.database_updated);
        assert!(saved.error.is_none());
        assert_eq!(
            super::super::read_track(Path::new(&path))
                .unwrap()
                .unwrap()
                .title
                .as_deref(),
            Some("Inbox title")
        );
        assert_eq!(
            database
                .connection()
                .unwrap()
                .query_row("SELECT title FROM tracks WHERE path=?1", [&path], |row| row
                    .get::<_, Option<String>>(0))
                .unwrap(),
            None
        );
        let failed = save_file(
            &FilePatch {
                path: files.0.join("missing.wav").to_string_lossy().into_owned(),
                ..patch
            },
            None,
        );
        assert!(!failed.file_written);
        assert!(failed.error.is_some());
        assert!(saved.file_written);
    }
}
