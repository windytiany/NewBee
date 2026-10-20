use super::model::TrackDetails;
use crate::database::blocking;

#[tauri::command]
pub async fn register_local_tracks<R: tauri::Runtime>(
    paths: Vec<String>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<super::model::TrackRegistrationResult>, String> {
    use tauri::Manager;
    let guard = app.state::<crate::locking::WriteState>().acquire()?;
    let results = blocking(app.clone(), move |database| {
        let _guard = guard;
        super::register(database, &paths)
    })
    .await?;
    super::confirmation::schedule(
        &app,
        results.iter().filter_map(|result| match result {
            super::model::TrackRegistrationResult::Registered {
                track,
                needs_metadata: true,
            } => Some(track.id),
            _ => None,
        }),
    );
    Ok(results)
}

#[tauri::command]
pub async fn is_track_metadata_pending<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    blocking(app, move |database| {
        database
            .pending_track(track_id)
            .map(|track| track.is_some())
    })
    .await
}

#[tauri::command]
pub async fn get_track_presentation<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<Option<super::model::TrackPresentation>, String> {
    blocking(app, move |database| {
        database.get_track_presentation(track_id)
    })
    .await
}

#[tauri::command]
pub async fn get_tracks<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<TrackDetails>, String> {
    blocking(app, move |database| database.get_tracks(&track_ids)).await
}

#[tauri::command]
pub async fn get_track<R: tauri::Runtime>(
    track_id: i64,
    app: tauri::AppHandle<R>,
) -> Result<Option<TrackDetails>, String> {
    blocking(app, move |database| database.get_track(track_id)).await
}

#[tauri::command]
pub async fn reread_track_tags<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<super::model::TrackReadResult>, String> {
    use tauri::Manager;
    let guard = app.state::<crate::locking::WriteState>().acquire()?;
    blocking(app, move |database| {
        let _guard = guard;
        let mut seen = std::collections::HashSet::new();
        Ok(track_ids
            .into_iter()
            .filter(|id| seen.insert(*id))
            .map(|track_id| {
                super::refresh::reread(database, track_id).unwrap_or_else(|error| {
                    super::model::TrackReadResult {
                        track_id,
                        database_updated: false,
                        error: Some(error),
                    }
                })
            })
            .collect())
    })
    .await
}
