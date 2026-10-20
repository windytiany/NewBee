use super::*;

impl<A: SessionAudio> Session<A> {
    pub(super) fn cancel_preparation(&mut self) -> Result<(), String> {
        self.prepared = None;
        self.preparation_signature = None;
        self.preparation_failures.clear();
        self.preparation_dirty = true;
        if let Some(id) = self.playback_id {
            self.preparation_revision += 1;
            self.audio.prepare(id, self.preparation_revision, None)?;
        }
        Ok(())
    }

    pub(super) fn prepare_next(&mut self) -> Result<(), String> {
        if self.editing.is_some() || self.seeking || !self.preparation_dirty {
            return Ok(());
        }
        self.preparation_dirty = false;
        let Some(id) = self.playback_id else {
            return Ok(());
        };
        let candidates = if self.handled_end == Some(id) {
            Vec::new()
        } else {
            self.queue
                .candidates(false, true, &self.skipped)
                .into_iter()
                .filter(|track| !self.preparation_failures.contains(&track.row_key))
                .collect()
        };
        let signature = (
            id,
            candidates
                .iter()
                .map(|track| track.row_key.clone())
                .collect::<Vec<_>>(),
        );
        if self.preparation_signature.as_ref() == Some(&signature) {
            return Ok(());
        }
        self.preparation_signature = Some(signature);
        if self.prepared.as_ref().is_some_and(|(prepared_id, key)| {
            *prepared_id == id
                && candidates
                    .first()
                    .is_some_and(|track| &track.row_key == key)
        }) {
            return Ok(());
        }
        self.prepared = None;
        if candidates.is_empty() {
            self.preparation_revision += 1;
            self.audio.prepare(id, self.preparation_revision, None)?;
        } else {
            let generation = self.generation.load(Ordering::SeqCst);
            for item in candidates {
                self.preparation_revision += 1;
                match self
                    .audio
                    .prepare(id, self.preparation_revision, Some(&item))
                {
                    Ok(true) => {
                        if !self.is_current(generation) {
                            self.cancel_preparation()?;
                            return Ok(());
                        }
                        self.prepared = Some((id, item.row_key));
                        return Ok(());
                    }
                    Ok(false) => return Ok(()),
                    Err(error) => {
                        self.preparation_failures.insert(item.row_key.clone());
                        log::warn!("Preloading row {} failed: {error}", item.row_key);
                        self.queue_errors.push(format!(
                            "{}: {error}",
                            item.title.as_deref().unwrap_or("Unknown track")
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn reconcile(&mut self) -> Result<bool, String> {
        let status = self.audio.status()?;
        let Some(track) = status.now_playing else {
            return Ok(false);
        };
        if self.playback_id == Some(track.playback_id) {
            return Ok(false);
        }
        if track.previous_playback_id != self.playback_id {
            return Ok(false);
        }
        let Some(key) = track.row_key.as_ref() else {
            return Ok(false);
        };
        if !self
            .queue
            .find(key)
            .is_some_and(|item| item.track_id == track.track_id)
        {
            return Ok(false);
        }
        self.queue.commit(key, false);
        self.current_track = Some(ListeningTrack::from(&track));
        self.playback_id = Some(track.playback_id);
        self.handled_end = None;
        self.prepared = None;
        self.preparation_signature = None;
        self.preparation_failures.clear();
        self.preparation_dirty = true;
        Ok(true)
    }
}
