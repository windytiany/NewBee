mod fingerprint;
use crate::{
    artwork::track::DirectoryPicture,
    database::Database,
    library::model::ImportResult,
    metadata::files::artwork,
    tracks::{
        inspect_with_directory,
        model::{Snapshot, TrackWriteOutcome},
    },
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const BATCH_TRACKS: usize = 32;
const BATCH_IMAGE_BYTES: usize = 16 * 1024 * 1024;

struct Directory {
    sources: Vec<(PathBuf, Vec<u8>)>,
    fingerprint: String,
    pictures: Option<Vec<DirectoryPicture>>,
}

impl Directory {
    fn inspect(audio: &Path) -> Result<Self, String> {
        let sources = artwork::directory_picture_paths(audio)?
            .into_iter()
            .map(|path| Ok((path.clone(), artwork::read_directory_bytes(&path)?)))
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Self {
            fingerprint: fingerprint::pictures(&sources)?,
            sources,
            pictures: None,
        })
    }

    fn pictures(&mut self) -> Vec<DirectoryPicture> {
        self.pictures
            .get_or_insert_with(|| {
                self.sources
                    .drain(..)
                    .map(|(path, bytes)| DirectoryPicture {
                        content: artwork::decode_directory_picture(&path, bytes),
                        path: path.to_string_lossy().into_owned(),
                    })
                    .collect()
            })
            .clone()
    }
}

#[cfg(test)]
pub(crate) fn run(
    database: &Database,
    files: &[PathBuf],
    result: &mut ImportResult,
    progress: impl FnMut(usize, usize),
) -> Result<(), String> {
    run_with_replay_gain(database, files, result, false, progress)
}

pub(crate) fn run_with_replay_gain(
    database: &Database,
    files: &[PathBuf],
    result: &mut ImportResult,
    fill_replay_gain: bool,
    mut progress: impl FnMut(usize, usize),
) -> Result<(), String> {
    if files.is_empty() {
        progress(0, 0);
        return Ok(());
    }
    let started = Instant::now();
    let mut detection = Duration::ZERO;
    let mut inspection = Duration::ZERO;
    let mut persistence = Duration::ZERO;
    let mut unchanged = 0;
    let states = database.scan_states()?;
    // Keep one directory's images alive, rather than retaining the entire library's covers.
    let mut files: Vec<_> = files.iter().collect();
    files.sort_unstable_by(|left, right| left.parent().cmp(&right.parent()).then(left.cmp(right)));
    let mut directory: Option<(PathBuf, Result<Directory, String>)> = None;
    let mut images = HashMap::new();
    let mut completed = 0;
    progress(0, files.len());
    while completed < files.len() {
        if crate::tasks::cancelled() {
            break;
        }
        let start = completed;
        let mut pending = Vec::new();
        let mut image_bytes = 0;
        while completed < files.len()
            && completed - start < BATCH_TRACKS
            && image_bytes < BATCH_IMAGE_BYTES
            && !crate::tasks::cancelled()
        {
            let path = files[completed];
            if fill_replay_gain {
                if let Err(error) = crate::metadata::replaygain::generate(path, false) {
                    result.record_failure(path, "replay_gain", &error);
                }
            }
            let detecting = Instant::now();
            let inspected_before = inspection;
            let prepared: Result<Option<_>, String> = (|| {
                let parent = path.parent().ok_or("Audio has no directory")?;
                if directory.as_ref().is_none_or(|(path, _)| path != parent) {
                    directory = Some((parent.to_owned(), Directory::inspect(path)));
                }
                let directory = directory
                    .as_mut()
                    .unwrap()
                    .1
                    .as_mut()
                    .map_err(|error| error.clone())?;
                let state = states.get(path.to_string_lossy().as_ref());
                let linked = state
                    .map(|state| state.linked.as_slice())
                    .unwrap_or_default();
                let before = fingerprint::track(path, &directory.fingerprint, linked, &mut images)?;
                if state.and_then(|state| state.fingerprint.as_ref()) == Some(&before) {
                    return Ok(None);
                }
                let inspecting = Instant::now();
                let snapshot = inspect_with_directory(database, path, || Ok(directory.pictures()));
                inspection += inspecting.elapsed();
                let snapshot = snapshot?;
                let after = fingerprint::track(path, &directory.fingerprint, linked, &mut images)?;
                Ok(Some((snapshot, (before == after).then_some(before))))
            })();
            detection += detecting
                .elapsed()
                .saturating_sub(inspection - inspected_before);
            match prepared {
                Ok(Some((snapshot, fingerprint))) => {
                    image_bytes += snapshot_bytes(&snapshot);
                    pending.push((snapshot, fingerprint));
                }
                Ok(None) => unchanged += 1,
                Err(error) => result.record_failure(path, "inspection", &error),
            }
            completed += 1;
            if fill_replay_gain {
                progress(completed, files.len());
            }
        }
        if !pending.is_empty() {
            let persisting = Instant::now();
            let outcomes = database.import_scanned_snapshots(&pending)?;
            persistence += persisting.elapsed();
            for ((snapshot, _), outcome) in pending.iter().zip(outcomes) {
                match outcome {
                    Ok(TrackWriteOutcome::Added) => result.added += 1,
                    Ok(TrackWriteOutcome::Updated) => result.updated += 1,
                    Ok(TrackWriteOutcome::Unchanged) => {}
                    Err(error) => {
                        result.record_failure(Path::new(&snapshot.track.path), "database", &error)
                    }
                }
            }
        }
        if !fill_replay_gain {
            for index in start..completed {
                progress(index + 1, files.len());
            }
        }
    }
    log::debug!("event=scan_processed total={} unchanged={} detectionMs={} inspectionMs={} persistenceMs={} elapsedMs={}",
        files.len(), unchanged, detection.as_millis(), inspection.as_millis(), persistence.as_millis(), started.elapsed().as_millis());
    Ok(())
}

fn snapshot_bytes(snapshot: &Snapshot) -> usize {
    let embedded = snapshot
        .artwork
        .embedded
        .as_ref()
        .map(|pictures| {
            pictures
                .iter()
                .map(|picture| picture.content.image.len())
                .sum::<usize>()
        })
        .unwrap_or(0);
    let directory = snapshot
        .artwork
        .directory
        .as_ref()
        .map(|pictures| {
            pictures
                .iter()
                .filter_map(|picture| picture.content.as_ref().ok())
                .map(|content| content.image.len())
                .sum::<usize>()
        })
        .unwrap_or(0);
    embedded
        + directory
        + snapshot
            .linked
            .iter()
            .map(|(_, content)| content.image.len())
            .sum::<usize>()
}
