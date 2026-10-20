use std::time::Duration;

const END_TOLERANCE: Duration = Duration::from_secs(3);

pub(crate) struct Playthrough {
    threshold_samples: Option<u64>,
    eligible: bool,
    recorded: bool,
}

impl Playthrough {
    pub(crate) fn new(duration: Duration, samples_per_second: u64) -> Self {
        let threshold_samples = (duration > END_TOLERANCE).then(|| {
            ((duration - END_TOLERANCE).as_secs_f64() * samples_per_second as f64).ceil() as u64
        });
        Self {
            threshold_samples,
            eligible: true,
            recorded: false,
        }
    }

    pub(crate) fn seek(&mut self) {
        self.eligible = false;
    }

    pub(crate) fn observe(&mut self, samples: u64, ended: bool) -> bool {
        if !self.eligible || self.recorded || samples == 0 {
            return false;
        }
        let completed = self
            .threshold_samples
            .map_or(ended, |threshold| samples >= threshold);
        if completed {
            self.recorded = true;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
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
}
