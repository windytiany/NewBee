use super::*;
use crate::database::Database;
use std::collections::HashMap;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataDelta {
    pub revision: u64,
    pub structural_revision: u64,
    pub displayed_tracks: Vec<QueueTrack>,
    pub current_track: Option<ListeningTrack>,
}

pub(super) fn read(database: &Database, ids: &[i64]) -> Result<Vec<MetadataUpdate>, String> {
    Ok(database
        .get_tracks(ids)?
        .into_iter()
        .map(|track| MetadataUpdate {
            id: Some(track.id),
            path: None,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration_ms: track
                .duration_ms
                .and_then(|duration| u64::try_from(duration).ok()),
        })
        .collect())
}

fn patch(
    queue: &mut Queue,
    current: &mut Option<ListeningTrack>,
    updates: Vec<MetadataUpdate>,
) -> (Vec<QueueTrack>, bool) {
    let updates: HashMap<_, _> = updates
        .into_iter()
        .filter_map(|update| update.id.map(|id| (id, update)))
        .collect();
    let mut rows = Vec::new();
    for track in &mut queue.displayed_tracks {
        let Some(update) = track.track_id.and_then(|id| updates.get(&id)) else {
            continue;
        };
        if track.title != update.title
            || track.album != update.album
            || track.duration_ms != update.duration_ms
        {
            track.title.clone_from(&update.title);
            track.album.clone_from(&update.album);
            track.duration_ms = update.duration_ms;
            rows.push(track.clone());
        }
    }
    let mut changed = false;
    if let Some(track) = current {
        if let Some(update) = track.track_id.and_then(|id| updates.get(&id)) {
            changed = track.title != update.title || track.artist != update.artist;
            track.title.clone_from(&update.title);
            track.artist.clone_from(&update.artist);
        }
    }
    (rows, changed)
}

pub(super) fn hydrate<A: SessionAudio>(audio: &A, saved: &mut SavedSession) -> Result<(), String> {
    let ids: Vec<_> = saved
        .queue
        .displayed_tracks
        .iter()
        .filter_map(|track| track.track_id)
        .chain(
            saved
                .current_track
                .as_ref()
                .and_then(|track| track.track_id),
        )
        .collect();
    if !ids.is_empty() {
        patch(
            &mut saved.queue,
            &mut saved.current_track,
            audio.metadata(&ids)?,
        );
    }
    Ok(())
}

impl<A: SessionAudio> Session<A> {
    // ID updates are read again at the worker boundary: a delayed frontend read
    // cannot overwrite a more recently confirmed DB edit. Path-only file edits
    // have no DB snapshot, and retain their confirmed reread display fields.
    pub(super) fn refresh_metadata(
        &mut self,
        mut tracks: Vec<MetadataUpdate>,
    ) -> Result<Option<MetadataDelta>, String> {
        let ids: Vec<_> = tracks.iter().filter_map(|track| track.id).collect();
        let mut confirmed = self.audio.metadata(&ids)?;
        tracks.retain(|track| track.id.is_none());
        for mut update in tracks {
            if let Some(path) = &update.path {
                let ids: Vec<_> = self
                    .queue
                    .displayed_tracks
                    .iter()
                    .filter_map(|track| track.track_id)
                    .collect();
                let paths = self.audio.paths(&ids)?;
                update.id = ids
                    .into_iter()
                    .zip(paths)
                    .find_map(|(id, known)| (&known == path).then_some(id));
                confirmed.push(update);
            }
        }
        Ok(self.update_metadata(confirmed))
    }

    pub(super) fn update_metadata(&mut self, tracks: Vec<MetadataUpdate>) -> Option<MetadataDelta> {
        let (displayed_tracks, current_changed) =
            patch(&mut self.queue, &mut self.current_track, tracks);
        if displayed_tracks.is_empty() && !current_changed {
            return None;
        }
        self.revision += 1;
        Some(MetadataDelta {
            revision: self.revision,
            structural_revision: self.structural_revision,
            displayed_tracks,
            current_track: self.current_track.clone(),
        })
    }
}
