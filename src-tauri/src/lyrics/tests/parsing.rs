use super::{lyrics_from_candidates, parse, select_lyrics_candidate, LyricLine, TrackLyrics};
use crate::metadata::files::lyrics::embedded_lyrics_text;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn prefers_synced_candidates_over_plain_text() {
    let selected = select_lyrics_candidate(["plain words", "[00:01.0]timed words"]);

    assert_eq!(selected, Some("[00:01.0]timed words"));
    assert!(matches!(
        selected.map(parse),
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
fn reads_lrc_text_from_the_id3_uslt_field() {
    use lofty::{
        config::WriteOptions,
        prelude::*,
        tag::{ItemKey, Tag, TagType},
    };
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = PathBuf::from(format!(
        "/tmp/newbee-lyrics-uslt-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("track.mp3");
    std::fs::write(&path, include_bytes!("../../../fixtures/silence.mp3")).unwrap();
    let mut tag = Tag::new(TagType::Id3v2);
    tag.insert_text(ItemKey::UnsyncLyrics, "[00:01.00]words".into());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let tagged_file = lofty::read_from_path(&path).unwrap();
    let result = embedded_lyrics_text(&tagged_file).map(parse).unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    assert_eq!(
        result,
        TrackLyrics::Synced {
            lines: vec![LyricLine {
                start_ms: 1_000,
                text: "words".into()
            }],
        }
    );
}

#[test]
fn empty_or_whitespace_text_has_no_lyrics() {
    assert_eq!(parse(""), TrackLyrics::None);
    assert_eq!(parse(" \t\r\n  "), TrackLyrics::None);
}

#[test]
fn plain_text_is_trimmed_and_newlines_are_normalized() {
    assert_eq!(
        parse("\r\n  first line\rsecond line  \r\n"),
        TrackLyrics::Plain {
            text: "first line\nsecond line".to_owned(),
        }
    );
}

#[test]
fn parses_all_supported_fractional_precisions() {
    assert_eq!(
        parse("[00:01]one\n[00:02.3]two\n[00:03.45]three\n[00:04.678]four"),
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
        parse("[00:01.03]two digits\n[00:02.004]three digits"),
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
        parse("[00:03.0][00:01.0]same\n[00:02.0]other"),
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
        parse("[00:03]third\n[00:01]first\n[00:02]second"),
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
        parse("[00:01]first\n[00:01]second\n[00:01]third"),
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
        parse("[ar:Artist]\nplain text\n[offset:25]\n[00:01]line"),
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
        parse("[offset:200]\n[00:01]first\n[offset:invalid]\n[offset:50]\n[00:02]second"),
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
        parse("[offset:-1500]\n[00:01]first\n[00:02]second"),
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
        parse("[00:01]\n[00:02]   "),
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
        parse(text),
        TrackLyrics::Plain {
            text: text.to_owned(),
        }
    );

    assert_eq!(
        parse("[00:01]valid [unclosed"),
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
        parse(
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
