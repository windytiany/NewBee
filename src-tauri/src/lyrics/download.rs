use super::{providers, LyricsCandidate, LyricsContent, LyricsProvider, LyricsSearchResults};

use crate::{
    database::{Database, TrackDetails},
    settings::SettingsState,
};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, State};

pub(super) fn providers(state: &SettingsState) -> Result<Vec<LyricsProvider>, String> {
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
    providers::search(provider, query, offset)
}
fn lyrics(provider: LyricsProvider, id: i64) -> Result<LyricsContent, String> {
    if id <= 0 {
        return Err("无效的歌词候选 ID".to_owned());
    }
    providers::lyrics(provider, id)
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

pub(super) fn automatic(
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

#[cfg(test)]
#[path = "tests/download.rs"]
mod tests;
