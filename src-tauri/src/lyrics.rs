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

    let lyrics_key = ItemKey::Lyrics;
    let candidates = tagged_file
        .tags()
        .iter()
        .flat_map(|tag| tag.get_strings(&lyrics_key));
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
mod tests {
    use super::{
        lyrics_from_candidates, parse_embedded_lyrics, read_embedded_lyrics,
        select_lyrics_candidate, LyricLine, TrackLyrics,
    };
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn prefers_synced_candidates_over_plain_text() {
        let selected = select_lyrics_candidate(["plain words", "[00:01.0]timed words"]);

        assert_eq!(selected, Some("[00:01.0]timed words"));
        assert!(matches!(
            selected.map(parse_embedded_lyrics),
            Some(TrackLyrics::Synced { .. })
        ));
    }

    #[test]
    fn ignores_empty_candidates() {
        assert_eq!(
            select_lyrics_candidate(["", " \t\r\n", "non-empty lyrics"]),
            Some("non-empty lyrics")
        );
    }

    #[test]
    fn selects_the_first_plain_candidate_in_stable_order() {
        assert_eq!(
            select_lyrics_candidate(["first plain lyrics", "second plain lyrics"]),
            Some("first plain lyrics")
        );
    }

    #[test]
    fn no_candidates_produce_no_lyrics() {
        assert_eq!(select_lyrics_candidate(std::iter::empty::<&str>()), None);
        assert_eq!(
            lyrics_from_candidates(std::iter::empty::<&str>()),
            TrackLyrics::None
        );
    }

    #[test]
    fn file_read_failure_is_distinct_from_missing_lyrics() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let missing_path = PathBuf::from(format!(
            "/tmp/newbee-lyrics-test-{}-{unique}/missing.mp3",
            std::process::id()
        ));

        let error = read_embedded_lyrics(42, &missing_path).unwrap_err();
        assert!(error.contains("track 42"));
        assert!(error.contains(&missing_path.display().to_string()));
        assert_eq!(
            lyrics_from_candidates(std::iter::empty::<&str>()),
            TrackLyrics::None
        );
    }

    #[test]
    fn empty_or_whitespace_text_has_no_lyrics() {
        assert_eq!(parse_embedded_lyrics(""), TrackLyrics::None);
        assert_eq!(parse_embedded_lyrics(" \t\r\n  "), TrackLyrics::None);
    }

    #[test]
    fn plain_text_is_trimmed_and_newlines_are_normalized() {
        assert_eq!(
            parse_embedded_lyrics("\r\n  first line\rsecond line  \r\n"),
            TrackLyrics::Plain {
                text: "first line\nsecond line".to_owned(),
            }
        );
    }

    #[test]
    fn parses_all_supported_fractional_precisions() {
        assert_eq!(
            parse_embedded_lyrics("[00:01]one\n[00:02.3]two\n[00:03.45]three\n[00:04.678]four"),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_000,
                        text: "one".to_owned(),
                    },
                    LyricLine {
                        start_ms: 2_300,
                        text: "two".to_owned(),
                    },
                    LyricLine {
                        start_ms: 3_450,
                        text: "three".to_owned(),
                    },
                    LyricLine {
                        start_ms: 4_678,
                        text: "four".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn fractional_precision_keeps_leading_zeroes() {
        assert_eq!(
            parse_embedded_lyrics("[00:01.03]two digits\n[00:02.004]three digits"),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_030,
                        text: "two digits".to_owned(),
                    },
                    LyricLine {
                        start_ms: 2_004,
                        text: "three digits".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn expands_multiple_timestamps_on_one_line() {
        assert_eq!(
            parse_embedded_lyrics("[00:03.0][00:01.0]same\n[00:02.0]other"),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_000,
                        text: "same".to_owned(),
                    },
                    LyricLine {
                        start_ms: 2_000,
                        text: "other".to_owned(),
                    },
                    LyricLine {
                        start_ms: 3_000,
                        text: "same".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn sorts_out_of_order_timestamps() {
        assert_eq!(
            parse_embedded_lyrics("[00:03]third\n[00:01]first\n[00:02]second"),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_000,
                        text: "first".to_owned(),
                    },
                    LyricLine {
                        start_ms: 2_000,
                        text: "second".to_owned(),
                    },
                    LyricLine {
                        start_ms: 3_000,
                        text: "third".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn keeps_original_order_for_equal_timestamps_without_merging() {
        assert_eq!(
            parse_embedded_lyrics("[00:01]first\n[00:01]second\n[00:01]third"),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_000,
                        text: "first".to_owned(),
                    },
                    LyricLine {
                        start_ms: 1_000,
                        text: "second".to_owned(),
                    },
                    LyricLine {
                        start_ms: 1_000,
                        text: "third".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn ignores_untimed_lines_and_metadata_in_synced_lyrics() {
        assert_eq!(
            parse_embedded_lyrics("[ar:Artist]\nplain text\n[offset:25]\n[00:01]line"),
            TrackLyrics::Synced {
                lines: vec![LyricLine {
                    start_ms: 1_025,
                    text: "line".to_owned(),
                }],
            }
        );
    }

    #[test]
    fn applies_the_last_valid_positive_offset_to_every_timestamp() {
        assert_eq!(
            parse_embedded_lyrics(
                "[offset:200]\n[00:01]first\n[offset:invalid]\n[offset:50]\n[00:02]second"
            ),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_050,
                        text: "first".to_owned(),
                    },
                    LyricLine {
                        start_ms: 2_050,
                        text: "second".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn clamps_negative_offset_timestamps_to_zero() {
        assert_eq!(
            parse_embedded_lyrics("[offset:-1500]\n[00:01]first\n[00:02]second"),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 0,
                        text: "first".to_owned(),
                    },
                    LyricLine {
                        start_ms: 500,
                        text: "second".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn preserves_empty_lyric_text() {
        assert_eq!(
            parse_embedded_lyrics("[00:01]\n[00:02]   "),
            TrackLyrics::Synced {
                lines: vec![
                    LyricLine {
                        start_ms: 1_000,
                        text: String::new(),
                    },
                    LyricLine {
                        start_ms: 2_000,
                        text: "   ".to_owned(),
                    },
                ],
            }
        );
    }

    #[test]
    fn invalid_tags_do_not_panic_or_create_timestamps() {
        let text = "ordinary\n[00:99]invalid seconds\n[00:01.1234]too precise\n[00:01:02]unsupported\n[offset:bad]";
        assert_eq!(
            parse_embedded_lyrics(text),
            TrackLyrics::Plain {
                text: text.to_owned(),
            }
        );

        assert_eq!(
            parse_embedded_lyrics("[00:01]valid [unclosed"),
            TrackLyrics::Synced {
                lines: vec![LyricLine {
                    start_ms: 1_000,
                    text: "valid [unclosed".to_owned(),
                }],
            }
        );
    }

    #[test]
    fn skips_timestamp_and_offset_arithmetic_overflow() {
        assert_eq!(
            parse_embedded_lyrics(
                "[offset:9223372036854775807]\n[160000000000000:00]offset overflow\n[18446744073709551615:00]timestamp overflow\n[00:01]valid"
            ),
            TrackLyrics::Synced {
                lines: vec![LyricLine {
                    start_ms: 9_223_372_036_854_776_807,
                    text: "valid".to_owned(),
                }],
            }
        );
    }

    #[test]
    fn serializes_with_the_discriminant_and_camel_case_fields() {
        let lyrics = TrackLyrics::Synced {
            lines: vec![LyricLine {
                start_ms: 1_234,
                text: "line".to_owned(),
            }],
        };
        assert_eq!(
            serde_json::to_value(lyrics).unwrap(),
            serde_json::json!({
                "kind": "synced",
                "lines": [{ "startMs": 1234, "text": "line" }]
            })
        );
    }
}
