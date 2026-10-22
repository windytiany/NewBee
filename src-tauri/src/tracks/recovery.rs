use super::model::References;
use crate::{database::Database, locking::WriteState};
use tauri::{AppHandle, Manager, Runtime};

pub(crate) fn resume<R: Runtime>(app: &AppHandle<R>, restored: Result<References, &str>) {
    cleanup(
        &app.state::<Database>(),
        &app.state::<WriteState>(),
        restored,
    );
    super::confirmation::initialize(app);
}

/// Startup only: the session worker has restored all references but has not
/// accepted commands, and the background scheduler has not been initialized.
/// The write gate also excludes foreground registration and metadata editing.
fn cleanup(database: &Database, write: &WriteState, restored: Result<References, &str>) {
    let references = match restored {
        Ok(references) => references,
        Err(reason) => {
            log::warn!("event=track_cleanup_skipped reason={reason}");
            return;
        }
    };
    let result = (|| {
        let _guard = write.acquire()?;
        database.collect_orphan_tracks(references)
    })();
    match result {
        Ok(deleted) => {
            log::info!("event=track_cleanup_completed deleted={deleted}");
            if deleted > 0 {
                if let Err(error) = database.clean_artwork_cache() {
                    log::warn!("event=track_cleanup_cache_failed error={error}");
                }
            }
        }
        Err(error) => log::warn!("event=track_cleanup_skipped reason={error}"),
    }
}
