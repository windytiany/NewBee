#[cfg(test)]
mod lookup_tests;
mod netease;

use crate::{
    database::{Database, TrackDetails},
    ingest::{IngestGuard, IngestState},
    metadata::{
        self,
        model::{normalize_changes, validate_track_ids, MetadataChange, MetadataField},
        MetadataSaveResult,
    },
    settings::SettingsState,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LyricsProvider {
    Netease,
}

pub(crate) fn default_providers() -> Vec<LyricsProvider> {
    vec![LyricsProvider::Netease]
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyricsCandidate {
    provider: LyricsProvider,
    id: i64,
    title: String,
    artists: Vec<String>,
    album: String,
    duration_ms: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyricsSearchResults {
    candidates: Vec<LyricsCandidate>,
    next_offset: Option<u32>,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum LyricsContent {
    Available { text: String },
    Instrumental,
    Missing,
}

fn providers(state: &SettingsState) -> Result<Vec<LyricsProvider>, String> {
    let providers = state.get()?.lyrics_providers;
    if providers.is_empty() {
        return Err("请先在设置中启用歌词来源".to_owned());
    }
    Ok(providers)
}
fn check_provider(provider: LyricsProvider, enabled: &[LyricsProvider]) -> Result<(), String> {
    if enabled.contains(&provider) {
        Ok(())
    } else {
        Err("此歌词来源未启用".to_owned())
    }
}
fn search(
    provider: LyricsProvider,
    query: &str,
    offset: u32,
) -> Result<LyricsSearchResults, String> {
    match provider {
        LyricsProvider::Netease => netease::search(query, offset),
    }
}
fn lyrics(provider: LyricsProvider, id: i64) -> Result<LyricsContent, String> {
    if id <= 0 {
        return Err("无效的歌词候选 ID".to_owned());
    }
    match provider {
        LyricsProvider::Netease => netease::lyrics(id),
    }
}

#[tauri::command]
pub(crate) async fn search_lyrics_candidates(
    query: String,
    provider: Option<LyricsProvider>,
    offset: u32,
    settings: State<'_, SettingsState>,
) -> Result<LyricsSearchResults, String> {
    let enabled = providers(&settings)?;
    let selected = provider
        .map(|provider| check_provider(provider, &enabled).map(|()| vec![provider]))
        .transpose()?
        .unwrap_or(enabled);
    let query = query.trim().to_owned();
    if query.is_empty() || query.len() > 1024 || offset > 10_000 {
        return Err("请输入有效的搜索条件".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Only NetEase is implemented; the ordered selection remains the provider seam.
        search(selected[0], &query, offset)
    })
    .await
    .map_err(|error| format!("歌词搜索任务失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn get_candidate_lyrics(
    provider: LyricsProvider,
    candidate_id: i64,
    settings: State<'_, SettingsState>,
) -> Result<LyricsContent, String> {
    check_provider(provider, &providers(&settings)?)?;
    tauri::async_runtime::spawn_blocking(move || lyrics(provider, candidate_id))
        .await
        .map_err(|error| format!("歌词预览任务失败：{error}"))?
}

fn track_query(track: &TrackDetails) -> (String, String) {
    let title = track
        .title()
        .filter(|title| !title.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            Path::new(track.path())
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
    let query = format!("{} {}", title, track.artist().unwrap_or_default())
        .trim()
        .to_owned();
    (title, query)
}
fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn match_score(
    candidate: &LyricsCandidate,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration_ms: Option<i64>,
) -> Option<u32> {
    if normalized(title).is_empty() || normalized(&candidate.title) != normalized(title) {
        return None;
    }
    if let Some(artist) = artist.filter(|artist| !artist.trim().is_empty()) {
        let artists: Vec<_> = artist
            .split(['/', ';', ',', '&', '、'])
            .map(normalized)
            .filter(|name| !name.is_empty())
            .collect();
        if !candidate
            .artists
            .iter()
            .any(|name| artists.contains(&normalized(name)))
        {
            return None;
        }
    }
    let mut score = 0;
    if album.is_some_and(|album| {
        !album.trim().is_empty() && normalized(album) == normalized(&candidate.album)
    }) {
        score += 2;
    }
    if let (Some(local), Some(remote)) = (
        duration_ms.and_then(|duration| u64::try_from(duration).ok()),
        candidate.duration_ms,
    ) {
        score += u32::from(local.abs_diff(remote) <= 3_000);
    }
    Some(score)
}

fn automatic(
    track: &TrackDetails,
    enabled: &[LyricsProvider],
    cancelled: &AtomicBool,
) -> Result<LyricsContent, String> {
    lookup(track, enabled, cancelled, search, lyrics)
}

fn lookup(
    track: &TrackDetails,
    enabled: &[LyricsProvider],
    cancelled: &AtomicBool,
    search: impl Fn(LyricsProvider, &str, u32) -> Result<LyricsSearchResults, String>,
    lyrics: impl Fn(LyricsProvider, i64) -> Result<LyricsContent, String>,
) -> Result<LyricsContent, String> {
    let (title, query) = track_query(track);
    let mut last_error = None;
    let mut instrumental = false;
    for provider in enabled {
        if cancelled.load(Ordering::Acquire) {
            return Err("歌词任务已取消".to_owned());
        }
        let result = match search(*provider, &query, 0) {
            Ok(result) => result,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        let mut candidates: Vec<_> = result
            .candidates
            .into_iter()
            .filter_map(|candidate| {
                match_score(
                    &candidate,
                    &title,
                    track.artist(),
                    track.album(),
                    track.duration_ms(),
                )
                .map(|score| (score, candidate))
            })
            .collect();
        candidates.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
        for (_, candidate) in candidates {
            if cancelled.load(Ordering::Acquire) {
                return Err("歌词任务已取消".to_owned());
            }
            match lyrics(candidate.provider, candidate.id) {
                Ok(content @ LyricsContent::Available { .. }) => return Ok(content),
                Ok(LyricsContent::Instrumental) => instrumental = true,
                Ok(LyricsContent::Missing) => {}
                Err(error) => last_error = Some(error),
            }
        }
    }
    if instrumental {
        Ok(LyricsContent::Instrumental)
    } else if let Some(error) = last_error {
        Err(error)
    } else {
        Ok(LyricsContent::Missing)
    }
}

#[tauri::command]
pub(crate) async fn find_track_lyrics(
    track_id: i64,
    app: tauri::AppHandle,
) -> Result<LyricsContent, String> {
    let enabled = providers(&app.state::<SettingsState>())?;
    tauri::async_runtime::spawn_blocking(move || {
        let track = app
            .state::<Database>()
            .get_track(track_id)?
            .ok_or_else(|| "曲目已不在曲库中".to_owned())?;
        automatic(&track, &enabled, &AtomicBool::new(false))
    })
    .await
    .map_err(|error| format!("自动获取歌词失败：{error}"))?
}

struct Batch {
    id: u64,
    track_ids: HashSet<i64>,
    providers: Vec<LyricsProvider>,
    cancelled: Arc<AtomicBool>,
    _guard: IngestGuard,
}
#[derive(Default)]
pub(crate) struct LyricsDownloadState {
    batch: Mutex<Option<Batch>>,
    next_id: AtomicU64,
}
impl LyricsDownloadState {
    fn validate<'a>(
        &self,
        batch: &'a Option<Batch>,
        batch_id: u64,
        track_id: i64,
    ) -> Result<&'a Batch, String> {
        batch
            .as_ref()
            .filter(|batch| batch.id == batch_id && batch.track_ids.contains(&track_id))
            .ok_or_else(|| "歌词下载任务已结束或曲目不属于此任务".to_owned())
    }
}

#[tauri::command]
pub(crate) fn begin_lyrics_download(
    track_ids: Vec<i64>,
    state: State<'_, LyricsDownloadState>,
    ingest: State<'_, IngestState>,
    settings: State<'_, SettingsState>,
) -> Result<u64, String> {
    let track_ids = validate_track_ids(&track_ids)?;
    let providers = providers(&settings)?;
    let mut batch = state.batch.lock().map_err(|error| error.to_string())?;
    if batch.is_some() {
        return Err("已有歌词下载任务正在运行".to_owned());
    }
    let guard = ingest.acquire()?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    *batch = Some(Batch {
        id,
        track_ids: track_ids.into_iter().collect(),
        providers,
        cancelled: Arc::new(AtomicBool::new(false)),
        _guard: guard,
    });
    Ok(id)
}

#[tauri::command]
pub(crate) async fn fetch_batch_lyrics(
    batch_id: u64,
    track_id: i64,
    app: tauri::AppHandle,
) -> Result<LyricsContent, String> {
    let (enabled, cancelled) = {
        let state = app.state::<LyricsDownloadState>();
        let batch = state.batch.lock().map_err(|error| error.to_string())?;
        let batch = state.validate(&batch, batch_id, track_id)?;
        (batch.providers.clone(), Arc::clone(&batch.cancelled))
    };
    tauri::async_runtime::spawn_blocking(move || {
        let track = app
            .state::<Database>()
            .get_track(track_id)?
            .ok_or_else(|| "曲目已不在曲库中".to_owned())?;
        // Intentionally no file reads or checks for existing lyrics before downloading.
        automatic(&track, &enabled, &cancelled)
    })
    .await
    .map_err(|error| format!("歌词下载失败：{error}"))?
}

#[tauri::command]
pub(crate) async fn write_batch_lyrics(
    batch_id: u64,
    track_id: i64,
    text: String,
    app: tauri::AppHandle,
) -> Result<MetadataSaveResult, String> {
    if text.trim().is_empty() || text.len() > 1024 * 1024 {
        return Err("歌词为空或过大，原文件未修改".to_owned());
    }
    let mut changes = vec![MetadataChange {
        field: MetadataField::Lyrics,
        value: Some(text),
    }];
    normalize_changes(&mut changes)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LyricsDownloadState>();
        let batch = state.batch.lock().map_err(|error| error.to_string())?;
        if state
            .validate(&batch, batch_id, track_id)?
            .cancelled
            .load(Ordering::Acquire)
        {
            return Err("歌词任务已取消".to_owned());
        }
        // Keep the batch guard until the atomic file replacement has finished.
        Ok(metadata::save_track(
            &app.state::<Database>(),
            track_id,
            &changes,
        ))
    })
    .await
    .map_err(|error| format!("歌词写入任务失败：{error}"))?
}

#[tauri::command]
pub(crate) fn cancel_lyrics_download(
    batch_id: u64,
    state: State<'_, LyricsDownloadState>,
) -> Result<(), String> {
    let batch = state.batch.lock().map_err(|error| error.to_string())?;
    let batch = batch
        .as_ref()
        .filter(|batch| batch.id == batch_id)
        .ok_or_else(|| "歌词任务已结束".to_owned())?;
    batch.cancelled.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub(crate) fn finish_lyrics_download(
    batch_id: u64,
    state: State<'_, LyricsDownloadState>,
) -> Result<(), String> {
    let mut batch = state.batch.lock().map_err(|error| error.to_string())?;
    if batch.as_ref().is_some_and(|batch| batch.id == batch_id) {
        *batch = None;
        Ok(())
    } else {
        Err("歌词下载任务已结束".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(title: &str, artist: &str) -> LyricsCandidate {
        LyricsCandidate {
            provider: LyricsProvider::Netease,
            id: 1,
            title: title.into(),
            artists: vec![artist.into()],
            album: "Album".into(),
            duration_ms: Some(200_000),
        }
    }
    #[test]
    fn excludes_covers_and_different_versions() {
        assert_eq!(
            match_score(
                &candidate("Song", "Artist"),
                "song",
                Some("Artist"),
                Some("Album"),
                Some(200_100)
            ),
            Some(3)
        );
        assert_eq!(
            match_score(
                &candidate("Song (Live)", "Artist"),
                "Song",
                Some("Artist"),
                None,
                None
            ),
            None
        );
        assert_eq!(
            match_score(
                &candidate("Song", "Cover Artist"),
                "Song",
                Some("Artist"),
                None,
                None
            ),
            None
        );
        assert_eq!(
            match_score(
                &candidate("Song", "Artist"),
                "Song",
                Some("Artist / Guest"),
                None,
                None
            ),
            Some(0)
        );
    }
    #[test]
    fn guards_reject_stale_batches_and_unselected_tracks() {
        let state = LyricsDownloadState::default();
        let ingest = IngestState::default();
        let batch = Some(Batch {
            id: 1,
            track_ids: HashSet::from([2]),
            providers: default_providers(),
            cancelled: Arc::new(AtomicBool::new(false)),
            _guard: ingest.acquire().unwrap(),
        });
        assert!(state.validate(&batch, 1, 2).is_ok());
        assert!(state.validate(&batch, 2, 2).is_err());
        assert!(state.validate(&batch, 1, 3).is_err());
        assert!(ingest.acquire().is_err());
        drop(batch);
        assert!(ingest.acquire().is_ok());
    }
}
