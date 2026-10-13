use super::QueueTrack;
use crate::{database::Database, tracks::model::TrackRegistrationResult};
use std::{collections::HashMap, path::Path};

#[derive(Default)]
pub(super) struct Registration {
    pub(super) pending: Vec<i64>,
    pub(super) failures: Vec<String>,
}

/// Path targets are an input only. Keep successful rows in their original order.
pub(super) fn register(
    database: &Database,
    tracks: &mut Vec<QueueTrack>,
) -> Result<Registration, String> {
    if tracks.iter().any(|track| !track.valid_target()) {
        return Err("Invalid playback target".into());
    }
    let mut registration = Registration::default();
    let mut canonical_paths = HashMap::new();
    let mut paths = Vec::new();
    for track in tracks.iter() {
        let Some(path) = &track.path else { continue };
        if canonical_paths.contains_key(path) {
            continue;
        }
        let outcome = Path::new(path)
            .canonicalize()
            .map_err(|error| error.to_string())
            .and_then(|canonical| {
                if canonical.is_file() {
                    Ok(canonical.to_string_lossy().into_owned())
                } else {
                    Err("Not an audio file".into())
                }
            });
        match outcome {
            Ok(canonical) => {
                paths.push(canonical.clone());
                canonical_paths.insert(path.clone(), Some(canonical));
            }
            Err(error) => {
                registration.failures.push(format!("{path}: {error}"));
                canonical_paths.insert(path.clone(), None);
            }
        }
    }
    let mut registered = HashMap::new();
    if !paths.is_empty() {
        for result in crate::tracks::registration::register(database, &paths)? {
            match result {
                TrackRegistrationResult::Registered {
                    track,
                    needs_metadata,
                } => {
                    if needs_metadata {
                        registration.pending.push(track.id);
                    }
                    registered.insert(track.path.clone(), track);
                }
                TrackRegistrationResult::Failed { path, error } => {
                    registration.failures.push(format!("{path}: {error}"))
                }
            }
        }
    }
    tracks.retain_mut(|target| {
        let Some(path) = &target.path else {
            return true;
        };
        let Some(track) = canonical_paths
            .get(path)
            .and_then(Option::as_ref)
            .and_then(|path| registered.get(path))
        else {
            return false;
        };
        target.track_id = Some(track.id);
        target.path = None;
        target.title = track.title.clone();
        target.album = track.album.clone();
        target.duration_ms = track
            .duration_ms
            .and_then(|duration| u64::try_from(duration).ok());
        true
    });
    for failure in &registration.failures {
        log::warn!("Playback registration failed: {failure}");
    }
    Ok(registration)
}
