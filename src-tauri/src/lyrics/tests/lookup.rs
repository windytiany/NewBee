use super::super::*;
use crate::database::TrackWriteInput;
use crate::lyrics::default_providers;
use std::cell::RefCell;

fn track() -> TrackDetails {
    let database = Database::open(":memory:").unwrap();
    database
        .upsert_track(&TrackWriteInput {
            path: "/nonexistent/song.mp3".into(),
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            album_artist: None,
            release_date: None,
            disc_number: None,
            track_number: None,
            disc_total: None,
            track_total: None,
            duration_ms: Some(200_000),
            codec: None,
            sample_rate_hz: None,
            bitrate_kbps: None,
            channels: None,
            artwork: None,
            editing: None,
            lyrics: None,
        })
        .unwrap();
    database.get_track(1).unwrap().unwrap()
}
fn candidates() -> LyricsSearchResults {
    LyricsSearchResults {
        candidates: [
            (1, "Cover", "Album"),
            (2, "Artist", "Album"),
            (3, "Artist", "Other"),
        ]
        .into_iter()
        .map(|(id, artist, album)| LyricsCandidate {
            provider: LyricsProvider::Netease,
            id,
            title: "Song".into(),
            artists: vec![artist.into()],
            album: album.into(),
            duration_ms: Some(200_000),
        })
        .collect(),
        next_offset: None,
    }
}

#[test]
fn downloads_without_reading_files_and_tries_matching_candidates_in_order() {
    let requested = RefCell::new(Vec::new());
    let result = lookup(
        &track(),
        &default_providers(),
        &AtomicBool::new(false),
        |_, query, _| {
            assert_eq!(query, "Song Artist");
            Ok(candidates())
        },
        |_, id| {
            requested.borrow_mut().push(id);
            if id == 2 {
                Ok(LyricsContent::Missing)
            } else {
                Ok(LyricsContent::Available {
                    text: "Downloaded lyrics".into(),
                })
            }
        },
    )
    .unwrap();
    assert_eq!(
        result,
        LyricsContent::Available {
            text: "Downloaded lyrics".into()
        }
    );
    assert_eq!(*requested.borrow(), vec![2, 3]);
}

#[test]
fn tries_next_candidate_after_a_request_error_without_replacing_with_empty_text() {
    let result = lookup(
        &track(),
        &default_providers(),
        &AtomicBool::new(false),
        |_, _, _| Ok(candidates()),
        |_, id| {
            if id == 2 {
                Err("timeout".into())
            } else {
                Ok(LyricsContent::Available {
                    text: "fallback".into(),
                })
            }
        },
    )
    .unwrap();
    assert_eq!(
        result,
        LyricsContent::Available {
            text: "fallback".into()
        }
    );
    assert!(lookup(
        &track(),
        &default_providers(),
        &AtomicBool::new(false),
        |_, _, _| Err("rate limited".into()),
        |_, _| panic!("must not fetch"),
    )
    .is_err());
}

#[test]
fn cancellation_stops_between_candidate_requests() {
    let cancelled = AtomicBool::new(false);
    let requested = RefCell::new(Vec::new());
    let result = lookup(
        &track(),
        &default_providers(),
        &cancelled,
        |_, _, _| Ok(candidates()),
        |_, id| {
            requested.borrow_mut().push(id);
            cancelled.store(true, Ordering::Release);
            Ok(LyricsContent::Missing)
        },
    );
    assert!(result.unwrap_err().contains("取消"));
    assert_eq!(*requested.borrow(), vec![2]);
}

#[test]
fn no_matching_candidates_does_not_download_a_cover() {
    let result = lookup(
        &track(),
        &default_providers(),
        &AtomicBool::new(false),
        |_, _, _| {
            Ok(LyricsSearchResults {
                candidates: vec![candidates().candidates.remove(0)],
                next_offset: None,
            })
        },
        |_, _| panic!("must not fetch the cover"),
    )
    .unwrap();
    assert_eq!(result, LyricsContent::Missing);
}
