use super::{discogs::Discogs, storage};
use crate::locking::write::WriteState;
use std::{collections::HashSet, path::Path, sync::Mutex};

#[derive(Default)]
pub(crate) struct LookupState(Mutex<Session>);

#[derive(Default)]
struct Session {
    attempted: HashSet<String>,
    discogs: Discogs,
}

impl LookupState {
    pub(super) fn find(
        &self,
        directory: &Path,
        artist: &str,
        writes: &WriteState,
    ) -> Result<bool, String> {
        let mut session = self
            .0
            .lock()
            .map_err(|_| "演出者照片搜索状态不可用".to_owned())?;
        let Session { attempted, discogs } = &mut *session;
        lookup(
            directory,
            artist,
            attempted,
            || discogs.find(artist),
            writes,
        )
    }
}

fn lookup(
    directory: &Path,
    artist: &str,
    attempted: &mut HashSet<String>,
    fetch: impl FnOnce() -> Result<Option<Vec<u8>>, String>,
    writes: &WriteState,
) -> Result<bool, String> {
    if storage::exists(directory, artist)? {
        return Ok(true);
    }
    if storage::searched(directory, artist)? || !attempted.insert(artist.to_owned()) {
        return Ok(false);
    }
    let photo = fetch()?;
    let _guard = writes.acquire()?;
    if storage::exists(directory, artist)? {
        return Ok(true);
    }
    match photo {
        Some(photo) => {
            storage::save_if_absent(directory, artist, &photo)?;
            Ok(true)
        }
        None => {
            storage::mark_missing(directory, artist)?;
            Ok(false)
        }
    }
}

#[cfg(test)]
#[path = "tests/lookup.rs"]
mod tests;
