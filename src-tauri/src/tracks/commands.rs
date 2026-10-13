use super::model::TrackDetails;
use crate::database::blocking;

#[tauri::command]
pub async fn register_local_tracks<R: tauri::Runtime>(
    paths: Vec<String>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<super::model::TrackRegistrationResult>, String> {
    use tauri::Manager;
    let guard = app.state::<crate::locking::write::WriteState>().acquire()?;
    let results = blocking(app.clone(), move |database| {
        let _guard = guard;
        super::registration::register(database, &paths)
    })
    .await?;
    super::scheduling::schedule(
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
    let guard = app.state::<crate::locking::write::WriteState>().acquire()?;
    blocking(app, move |database| {
        let _guard = guard;
        let mut seen = std::collections::HashSet::new();
        Ok(track_ids
            .into_iter()
            .filter(|id| seen.insert(*id))
            .map(|track_id| {
                let outcome = super::reading::reread(database, track_id);
                super::model::TrackReadResult {
                    track_id,
                    database_updated: outcome.is_ok(),
                    error: outcome.err(),
                }
            })
            .collect())
    })
    .await
}
