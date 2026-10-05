mod lookup;

use super::*;
use crate::lyrics::default_providers;
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
    let write = WriteState::default();
    let batch = Some(Batch {
        id: 1,
        track_ids: HashSet::from([2]),
        providers: default_providers(),
        cancelled: Arc::new(AtomicBool::new(false)),
        _guard: write.acquire().unwrap(),
    });
    assert!(state.validate(&batch, 1, 2).is_ok());
    assert!(state.validate(&batch, 2, 2).is_err());
    assert!(state.validate(&batch, 1, 3).is_err());
    assert!(write.acquire().is_err());
    drop(batch);
    assert!(write.acquire().is_ok());
}
