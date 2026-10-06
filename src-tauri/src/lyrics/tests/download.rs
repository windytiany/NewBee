mod lookup;

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
