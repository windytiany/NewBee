use super::{
    model::LyricsDownloadTarget, providers, LyricsCandidate, LyricsContent, LyricsProvider,
    LyricsSearchResults,
};

use crate::{database::Database, settings::SettingsState, tracks::model::TrackDetails};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, State};

#[tauri::command]
pub(crate) async fn get_lyrics_download_targets<R: tauri::Runtime>(
    track_ids: Vec<i64>,
    app: tauri::AppHandle<R>,
) -> Result<Vec<LyricsDownloadTarget>, String> {
    let track_ids = crate::metadata::model::validate_track_ids(&track_ids)?;
    crate::database::blocking(app, move |database| {
        database.lyrics_download_targets(&track_ids)
    })
    .await
}

pub(super) fn provider_set(state: &SettingsState) -> Result<providers::LyricsProviderSet, String> {
    providers::LyricsProviderSet::from_settings(state.get()?)
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
    let started = std::time::Instant::now();
    let result = providers::search(provider, query, offset);
    log::debug!(
        "event=lyrics_search provider={} elapsedMs={} success={}",
        provider.identifier(),
        started.elapsed().as_millis(),
        result.is_ok()
    );
    if let Err(error) = &result {
        log::debug!(
            "event=lyrics_search_failed provider={} error={error}",
            provider.identifier()
        );
    }
    result
}
fn lyrics(
    provider_set: &providers::LyricsProviderSet,
    provider: LyricsProvider,
    id: i64,
) -> Result<LyricsContent, String> {
    if id <= 0 {
        return Err("无效的歌词候选 ID".to_owned());
    }
    let started = std::time::Instant::now();
    let result = provider_set.lyrics(provider, id);
    log::debug!(
        "event=lyrics_fetch provider={} candidateId={id} elapsedMs={} success={}",
        provider.identifier(),
        started.elapsed().as_millis(),
        result.is_ok()
    );
    if let Err(error) = &result {
        log::debug!(
            "event=lyrics_fetch_failed provider={} candidateId={id} error={error}",
            provider.identifier()
        );
    }
    result
}

#[tauri::command]
pub(crate) async fn search_lyrics_candidates(
    query: String,
    provider: Option<LyricsProvider>,
    offset: u32,
    settings: State<'_, SettingsState>,
) -> Result<LyricsSearchResults, String> {
    let enabled = provider_set(&settings)?.enabled().to_vec();
    let selected = provider
        .map(|provider| check_provider(provider, &enabled).map(|()| vec![provider]))
        .transpose()?
        .unwrap_or(enabled);
    let query = query.trim().to_owned();
    if query.is_empty() || query.len() > 1024 || offset > 10_000 {
        return Err("请输入有效的搜索条件".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // The first configured provider is the default search source.
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
    let provider_set = provider_set(&settings)?;
    check_provider(provider, provider_set.enabled())?;
    tauri::async_runtime::spawn_blocking(move || lyrics(&provider_set, provider, candidate_id))
        .await
        .map_err(|error| format!("歌词预览任务失败：{error}"))?
}

trait LyricsTrack {
    fn path(&self) -> &str;
    fn title(&self) -> Option<&str>;
    fn artist(&self) -> Option<&str>;
    fn album(&self) -> Option<&str>;
    fn duration_ms(&self) -> Option<i64>;
}
impl LyricsTrack for TrackDetails {
    fn path(&self) -> &str {
        self.path()
    }
    fn title(&self) -> Option<&str> {
        self.title()
    }
    fn artist(&self) -> Option<&str> {
        self.artist()
    }
    fn album(&self) -> Option<&str> {
        self.album()
    }
    fn duration_ms(&self) -> Option<i64> {
        self.duration_ms()
    }
}
impl LyricsTrack for crate::tracks::model::TrackWriteInput {
    fn path(&self) -> &str {
        &self.path
    }
    fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }
    fn artist(&self) -> Option<&str> {
        self.artist.as_deref()
    }
    fn album(&self) -> Option<&str> {
        self.album.as_deref()
    }
    fn duration_ms(&self) -> Option<i64> {
        self.duration_ms
    }
}
fn track_query(track: &impl LyricsTrack) -> (String, String) {
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

pub(super) fn automatic(
    track: &TrackDetails,
    provider_set: &providers::LyricsProviderSet,
    cancelled: &AtomicBool,
) -> Result<LyricsContent, String> {
    lookup(
        track,
        provider_set.enabled(),
        cancelled,
        search,
        |provider, id| lyrics(provider_set, provider, id),
    )
}

fn lookup(
    track: &impl LyricsTrack,
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
    let provider_set = provider_set(&app.state::<SettingsState>())?;
    tauri::async_runtime::spawn_blocking(move || {
        let track = app
            .state::<Database>()
            .get_track(track_id)?
            .ok_or_else(|| "曲目已不在曲库中".to_owned())?;
        automatic(&track, &provider_set, &AtomicBool::new(false))
    })
    .await
    .map_err(|error| format!("自动获取歌词失败：{error}"))?
}

#[cfg(test)]
#[path = "tests/download.rs"]
mod tests;

#[tauri::command]
pub(crate) async fn find_file_lyrics(
    path: String,
    app: tauri::AppHandle,
) -> Result<LyricsContent, String> {
    let provider_set = provider_set(&app.state::<SettingsState>())?;
    tauri::async_runtime::spawn_blocking(move || {
        let track = crate::metadata::files::read_track(Path::new(&path))?
            .ok_or_else(|| "不支持的音频文件".to_owned())?;
        lookup(
            &track,
            provider_set.enabled(),
            &AtomicBool::new(false),
            search,
            |provider, id| lyrics(&provider_set, provider, id),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}
