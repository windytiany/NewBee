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
#[path = "tests/qualification.rs"]
mod tests;
