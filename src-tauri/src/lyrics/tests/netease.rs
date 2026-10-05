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
            decode_lyrics(serde_json::from_str(json).unwrap()).unwrap(),
            expected
        );
    }
    assert!(decode_lyrics(serde_json::from_str(r#"{"code":460}"#).unwrap()).is_err());
    assert!(decode_search(serde_json::from_str(r#"{"code":460}"#).unwrap(), 0).is_err());
}
#[test]
#[ignore = "requires live access to NetEase"]
fn live_search_and_lyrics() {
    let result = search("陈奕迅 十年", 0).unwrap();
    assert!(result
        .candidates
        .iter()
        .any(|candidate| candidate.id == 66842));
    assert!(matches!(
        lyrics(66842).unwrap(),
        LyricsContent::Available { .. }
    ));
}
