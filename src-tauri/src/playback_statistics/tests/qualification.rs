use super::*;

#[test]
fn counts_at_the_last_three_seconds_only_once() {
    let mut play = Playthrough::new(Duration::from_secs(10), 100);
    assert!(!play.observe(0, false));
    assert!(!play.observe(699, false));
    assert!(play.observe(700, false));
    assert!(!play.observe(1000, true));
    assert!(!play.observe(1000, true));
}

#[test]
fn short_and_unknown_tracks_require_an_end_after_audio() {
    for duration in [
        Duration::ZERO,
        Duration::from_secs(1),
        Duration::from_secs(3),
    ] {
        let mut play = Playthrough::new(duration, 100);
        assert!(!play.observe(0, true));
        assert!(!play.observe(100, false));
        assert!(play.observe(100, true));
        assert!(!play.observe(100, true));
    }
}

#[test]
fn any_seek_disqualifies_the_round_without_reversing_an_existing_count() {
    let mut play = Playthrough::new(Duration::from_secs(10), 100);
    assert!(!play.observe(200, false));
    play.seek();
    assert!(!play.observe(700, false));
    assert!(!play.observe(1000, true));
    let mut play = Playthrough::new(Duration::from_secs(10), 100);
    assert!(play.observe(700, false));
    play.seek();
    assert!(!play.observe(1000, true));
}

#[test]
fn premature_end_of_a_long_track_does_not_count() {
    let mut play = Playthrough::new(Duration::from_secs(10), 100);
    assert!(!play.observe(100, true));
}

#[test]
fn repeated_rounds_start_with_fresh_eligibility() {
    for _ in 0..3 {
        let mut play = Playthrough::new(Duration::from_secs(10), 100);
        assert!(play.observe(700, false));
        assert!(!play.observe(1000, true));
    }
}
