use super::*;
#[test]
fn decodes_candidates_and_pagination() {
    let response = serde_json::from_str(r#"{"code":200,"result":{"songCount":31,"songs":[{"id":66842,"name":"十年","artists":[{"name":"陈奕迅"}],"album":{"name":"黑白灰"},"duration":205423}]}}"#).unwrap();
    let result = decode_search(response, 0).unwrap();
    assert_eq!(result.next_offset, Some(1));
    assert_eq!(result.candidates[0].artists, vec!["陈奕迅"]);
    assert_eq!(result.candidates[0].duration_ms, Some(205423));
    assert_eq!(encode("十年 A&B"), "%E5%8D%81%E5%B9%B4%20A%26B");
}
#[test]
fn distinguishes_missing_instrumental_and_failure() {
    for (json, expected) in [
        (
            r#"{"code":200,"nolyric":true}"#,
            LyricsContent::Instrumental,
        ),
        (
            r#"{"code":200,"pureMusic":true,"lrc":{"lyric":"[00:05.00]纯音乐，请欣赏"}}"#,
            LyricsContent::Instrumental,
        ),
        (r#"{"code":200,"uncollected":true}"#, LyricsContent::Missing),
        (
            r#"{"code":200,"lrc":{"lyric":"  "}}"#,
            LyricsContent::Missing,
        ),
        (
            r#"{"code":200,"lrc":{"lyric":"[00:01]words"}}"#,
            LyricsContent::Available {
                text: "[00:01]words".into(),
            },
        ),
    ] {
        assert_eq!(
            decode_lyrics(
                serde_json::from_str(json).unwrap(),
                NeteaseLyricsMode::Original
            )
            .unwrap(),
            expected
        );
    }
    assert!(decode_lyrics(
        serde_json::from_str(r#"{"code":460}"#).unwrap(),
        NeteaseLyricsMode::Original
    )
    .is_err());
    assert!(decode_search(serde_json::from_str(r#"{"code":460}"#).unwrap(), 0).is_err());
}
#[test]
fn selects_original_translated_and_bilingual_lyrics() {
    let response = || {
        serde_json::from_str::<LyricResponse>(
            r#"{"code":200,"lrc":{"lyric":"[00:01]hello\n[00:02]world"},"tlyric":{"lyric":"[00:01]你好\n[00:02]世界"}}"#,
        )
        .unwrap()
    };
    assert_eq!(
        decode_lyrics(response(), NeteaseLyricsMode::Original).unwrap(),
        LyricsContent::Available {
            text: "[00:01]hello\n[00:02]world".into(),
        }
    );
    assert_eq!(
        decode_lyrics(response(), NeteaseLyricsMode::Translated).unwrap(),
        LyricsContent::Available {
            text: "[00:01]你好\n[00:02]世界".into(),
        }
    );
    assert_eq!(
        decode_lyrics(response(), NeteaseLyricsMode::Bilingual).unwrap(),
        LyricsContent::Available {
            text: "[00:01.000]hello / 你好\n[00:02.000]world / 世界".into(),
        }
    );
}
#[test]
fn missing_translation_falls_back_to_original() {
    let original = || {
        serde_json::from_str::<LyricResponse>(r#"{"code":200,"lrc":{"lyric":"[00:01]hello"}}"#)
            .unwrap()
    };
    assert_eq!(
        decode_lyrics(original(), NeteaseLyricsMode::Translated).unwrap(),
        LyricsContent::Available {
            text: "[00:01]hello".into(),
        }
    );
    assert_eq!(
        decode_lyrics(original(), NeteaseLyricsMode::Bilingual).unwrap(),
        LyricsContent::Available {
            text: "[00:01]hello".into(),
        }
    );
    for mode in [NeteaseLyricsMode::Translated, NeteaseLyricsMode::Bilingual] {
        let response =
            serde_json::from_str(r#"{"code":200,"lrc":{"lyric":"hello"},"tlyric":{"lyric":"  "}}"#)
                .unwrap();
        assert_eq!(
            decode_lyrics(response, mode).unwrap(),
            LyricsContent::Available {
                text: "hello".into(),
            }
        );
    }
}
#[test]
fn bilingual_matches_timestamps_not_line_numbers() {
    let response = serde_json::from_str(
        r#"{"code":200,"lrc":{"lyric":"[00:00.000] 作词 : Adele Adkins\n[00:01.000] 作曲 : Adele Adkins/Greg Kurstin\n[00:06.220]Hello, it's me\n[00:11.320]I was wondering"},"tlyric":{"lyric":"[by:歌词上传者]\n[00:06.22]你好 是我\n[00:11.32]我犹豫着\n[00:15.000]多余翻译"}}"#,
    ).unwrap();
    assert_eq!(
        decode_lyrics(response, NeteaseLyricsMode::Bilingual).unwrap(),
        LyricsContent::Available {
            text: "[00:00.000] 作词 : Adele Adkins\n[00:01.000] 作曲 : Adele Adkins/Greg Kurstin\n[00:06.220]Hello, it's me / 你好 是我\n[00:11.320]I was wondering / 我犹豫着".into(),
        }
    );
}
#[test]
fn bilingual_expands_repeated_timestamps_and_requires_exact_matches() {
    let response = serde_json::from_str(
        r#"{"code":200,"lrc":{"lyric":"[00:01.00][00:03.000]hello\r\n[00:02]world"},"tlyric":{"lyric":"[00:03]你好\n[00:02.001]世界\n[00:04]多余翻译"}}"#,
    ).unwrap();
    assert_eq!(
        decode_lyrics(response, NeteaseLyricsMode::Bilingual).unwrap(),
        LyricsContent::Available {
            text: "[00:01.000]hello\n[00:02.000]world\n[00:03.000]hello / 你好".into(),
        }
    );
}
#[test]
fn bilingual_matches_effective_timestamps_with_offsets() {
    let response = serde_json::from_str(
        r#"{"code":200,"lrc":{"lyric":"[offset:100]\n[00:01]hello"},"tlyric":{"lyric":"[00:01.100]你好"}}"#,
    ).unwrap();
    assert_eq!(
        decode_lyrics(response, NeteaseLyricsMode::Bilingual).unwrap(),
        LyricsContent::Available {
            text: "[00:01.100]hello / 你好".into(),
        }
    );
}
#[test]
fn bilingual_plain_text_and_partial_translation() {
    for (original, translated, expected) in [
        ("hello\nworld", "你好", "hello / 你好\nworld"),
        (
            "[00:01]hello\n[00:02]world",
            "[00:01]\n[00:02]世界",
            "[00:01.000]hello\n[00:02.000]world / 世界",
        ),
    ] {
        let response = serde_json::from_value(serde_json::json!({
            "code": 200, "lrc": {"lyric": original}, "tlyric": {"lyric": translated},
        }))
        .unwrap();
        assert_eq!(
            decode_lyrics(response, NeteaseLyricsMode::Bilingual).unwrap(),
            LyricsContent::Available {
                text: expected.into(),
            }
        );
    }
}
#[test]
fn rejects_invalid_characters_in_selected_lyrics() {
    for mode in [
        NeteaseLyricsMode::Original,
        NeteaseLyricsMode::Translated,
        NeteaseLyricsMode::Bilingual,
    ] {
        let response = serde_json::from_value(serde_json::json!({
            "code": 200, "lrc": {"lyric": "hello\u{0000}"}, "tlyric": {"lyric": "你好\u{0000}"},
        }))
        .unwrap();
        assert!(decode_lyrics(response, mode).is_err());
    }
}
