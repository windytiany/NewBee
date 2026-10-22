use crate::{database::Database, locking::WriteState};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};
use tauri::{ipc::Channel, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateResult {
    track_id: Option<i64>,
    file_written: bool,
    database_updated: bool,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    completed: usize,
    total: usize,
}

pub(super) fn analyze_tracks(
    database: &Database,
    track_ids: Vec<i64>,
    paths: Vec<String>,
    progress: impl FnMut(Progress),
) -> Vec<UpdateResult> {
    update_tracks(database, track_ids, paths, progress, |path| {
        super::generate(path, true)
    })
}

pub(super) fn restore_tracks(
    database: &Database,
    track_ids: Vec<i64>,
    paths: Vec<String>,
    progress: impl FnMut(Progress),
) -> Vec<UpdateResult> {
    update_tracks(
        database,
        track_ids,
        paths,
        progress,
        crate::metadata::files::replaygain::remove,
    )
}

fn update_tracks(
    database: &Database,
    track_ids: Vec<i64>,
    paths: Vec<String>,
    mut progress: impl FnMut(Progress),
    update: impl Fn(&Path) -> Result<bool, String>,
) -> Vec<UpdateResult> {
    let mut seen = HashSet::new();
    let mut seen_paths = HashSet::new();
    let tracks = track_ids
        .into_iter()
        .filter(|id| seen.insert(*id))
        .map(|id| {
            let path = database.get_track(id).and_then(|track| {
                track
                    .map(|track| PathBuf::from(track.path()))
                    .ok_or_else(|| "曲目已不在数据库中".to_owned())
            });
            (Some(id), path)
        });
    let files = paths
        .into_iter()
        .map(|path| (None, Ok(PathBuf::from(path))));
    let targets: Vec<_> = tracks
        .chain(files)
        .filter(|(_, path)| {
            path.as_ref()
                .map(|path| {
                    seen_paths.insert(std::fs::canonicalize(path).unwrap_or_else(|_| path.clone()))
                })
                .unwrap_or(true)
        })
        .collect();
    progress(Progress {
        completed: 0,
        total: targets.len(),
    });
    targets.iter().enumerate().take_while(|_| !crate::tasks::cancelled()).map(|(index, (track_id, path))| {
        let mut result = UpdateResult { track_id: *track_id, file_written: false, database_updated: false, error: None };
        let outcome = (|| {
            let path = path.as_ref().map_err(Clone::clone)?;
            result.file_written = update(path)?;
            if let Some(track_id) = track_id {
                database.begin_track_inspection(*track_id)?;
                crate::tracks::reread(database, *track_id).map_err(|error| format!("曲目信息刷新失败：{error}"))?;
                result.database_updated = true;
            }
            Ok::<_, String>(())
        })();
        result.error = outcome.err();
        if let Some(error) = &result.error {
            log::warn!("event=loudness_update_failed trackId={track_id:?} fileWritten={} error={error}", result.file_written);
        }
        progress(Progress { completed: index + 1, total: targets.len() });
        result
    }).collect()
}

#[tauri::command]
pub(crate) async fn analyze_track_loudness<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    paths: Vec<String>,
    on_progress: Channel<Progress>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<UpdateResult>, String> {
    crate::tasks::validate(
        &app.state::<Database>(),
        &track_ids,
        operation_id.as_deref(),
        &[],
    )?;
    let guard = app
        .state::<WriteState>()
        .acquire_task(operation_id.as_deref())
        .await?;
    crate::database::blocking(app, move |database| {
        crate::tasks::with_operation(operation_id, || {
            let _guard = guard;
            Ok(analyze_tracks(database, track_ids, paths, |progress| {
                if let Err(error) = on_progress.send(progress) {
                    log::debug!("Could not publish loudness analysis progress: {error}");
                }
            }))
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn restore_track_loudness<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    paths: Vec<String>,
    on_progress: Channel<Progress>,
    operation_id: Option<String>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<UpdateResult>, String> {
    crate::tasks::validate(
        &app.state::<Database>(),
        &track_ids,
        operation_id.as_deref(),
        &[],
    )?;
    let guard = app
        .state::<WriteState>()
        .acquire_task(operation_id.as_deref())
        .await?;
    crate::database::blocking(app, move |database| {
        crate::tasks::with_operation(operation_id, || {
            let _guard = guard;
            Ok(restore_tracks(database, track_ids, paths, |progress| {
                if let Err(error) = on_progress.send(progress) {
                    log::debug!("Could not publish loudness restoration progress: {error}");
                }
            }))
        })
    })
    .await
}
