use crate::database::Database;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::ItemKey;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub start_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TrackLyrics {
    None,
    Plain { text: String },
    Synced { lines: Vec<LyricLine> },
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_track_lyrics(
    track_id: i64,
    state: State<'_, Database>,
) -> Result<TrackLyrics, String> {
    let details = state
        .get_track(track_id)?
        .ok_or_else(|| format!("Track {track_id} was not found"))?;
    let path = PathBuf::from(details.path());
    drop(details);

    let path_context = path.display().to_string();
    tauri::async_runtime::spawn_blocking(move || read_embedded_lyrics(track_id, &path))
        .await
        .map_err(|error| {
            format!("Blocking lyric read failed for track {track_id} at '{path_context}': {error}")
        })?
}

fn read_embedded_lyrics(track_id: i64, path: &Path) -> Result<TrackLyrics, String> {
    let context = format!("track {track_id} at '{}'", path.display());
    let tagged_file = Probe::open(path)
        .map_err(|error| format!("Failed to open audio file for {context}: {error}"))?
        .guess_file_type()
        .map_err(|error| format!("Failed to detect audio file type for {context}: {error}"))?
        .read()
        .map_err(|error| format!("Failed to read or parse audio tags for {context}: {error}"))?;

    let candidates = tagged_file.tags().iter().flat_map(|tag| {
        [ItemKey::Lyrics, ItemKey::UnsyncLyrics]
            .into_iter()
            .flat_map(move |key| tag.get_strings(key))
    });
    Ok(lyrics_from_candidates(candidates))
}

fn lyrics_from_candidates<'a>(candidates: impl IntoIterator<Item = &'a str>) -> TrackLyrics {
    select_lyrics_candidate(candidates)
        .map(parse_embedded_lyrics)
        .unwrap_or(TrackLyrics::None)
}

fn select_lyrics_candidate<'a>(candidates: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    let mut first_plain = None;

    for candidate in candidates {
        match parse_embedded_lyrics(candidate) {
            TrackLyrics::None => {}
            TrackLyrics::Plain { .. } => {
                first_plain.get_or_insert(candidate);
            }
            TrackLyrics::Synced { .. } => return Some(candidate),
        }
    }

    first_plain
}

pub fn parse_embedded_lyrics(text: &str) -> TrackLyrics {
    if text.trim().is_empty() {
        return TrackLyrics::None;
    }

    let normalized_text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut offset_ms = 0;
    let mut timestamped_lines = Vec::new();

    for line in normalized_text.lines() {
        let (timestamps, lyric_text) = parse_line(line, &mut offset_ms);
        for timestamp_ms in timestamps {
            timestamped_lines.push((timestamp_ms, lyric_text.clone()));
        }
    }

    let mut lines = timestamped_lines
        .into_iter()
        .filter_map(|(timestamp_ms, lyric_text)| {
            apply_offset(timestamp_ms, offset_ms).map(|start_ms| LyricLine {
                start_ms,
                text: lyric_text,
            })
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return TrackLyrics::Plain {
            text: normalized_text.trim().to_owned(),
        };
    }

    lines.sort_by_key(|line| line.start_ms);
    TrackLyrics::Synced { lines }
}

fn parse_line(line: &str, offset_ms: &mut i64) -> (Vec<u64>, String) {
    let mut timestamps = Vec::new();
    let mut lyric_text = String::with_capacity(line.len());
    let mut cursor = 0;

    loop {
        let Some(open_offset) = line[cursor..].find('[') else {
            lyric_text.push_str(&line[cursor..]);
            break;
        };
        let open = cursor + open_offset;
        lyric_text.push_str(&line[cursor..open]);

        let tag_start = open + 1;
        let Some(close_offset) = line[tag_start..].find(']') else {
            lyric_text.push_str(&line[open..]);
            break;
        };
        let close = tag_start + close_offset;
        let tag = &line[tag_start..close];

        if let Some(timestamp_ms) = parse_timestamp(tag) {
            timestamps.push(timestamp_ms);
        } else if let Some(value) = parse_offset(tag) {
            *offset_ms = value;
        } else {
            lyric_text.push_str(&line[open..=close]);
        }

        cursor = close + 1;
    }

    (timestamps, lyric_text)
}

fn parse_timestamp(tag: &str) -> Option<u64> {
    let (minutes, seconds) = tag.split_once(':')?;
    if !is_ascii_digits(minutes) {
        return None;
    }

    let minutes = minutes.parse::<u64>().ok()?;
    let (seconds, fraction_ms) = match seconds.split_once('.') {
        Some((seconds, fraction)) => (seconds, parse_fraction_ms(fraction)?),
        None => (seconds, 0),
    };
    if seconds.len() != 2 || !is_ascii_digits(seconds) {
        return None;
    }

    let seconds = seconds.parse::<u64>().ok()?;
    if seconds >= 60 {
        return None;
    }

    minutes
        .checked_mul(60_000)?
        .checked_add(seconds.checked_mul(1_000)?)?
        .checked_add(fraction_ms)
}

fn parse_fraction_ms(fraction: &str) -> Option<u64> {
    if !is_ascii_digits(fraction) {
        return None;
    }

    let multiplier = match fraction.len() {
        1 => 100,
        2 => 10,
        3 => 1,
        _ => return None,
    };
    fraction.parse::<u64>().ok()?.checked_mul(multiplier)
}

fn parse_offset(tag: &str) -> Option<i64> {
    tag.strip_prefix("offset:")?.parse::<i64>().ok()
}

fn is_ascii_digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn apply_offset(timestamp_ms: u64, offset_ms: i64) -> Option<u64> {
    if offset_ms >= 0 {
        timestamp_ms.checked_add(offset_ms as u64)
    } else {
        Some(timestamp_ms.saturating_sub(offset_ms.unsigned_abs()))
    }
}

#[cfg(test)]
#[path = "tests/local.rs"]
mod tests;
