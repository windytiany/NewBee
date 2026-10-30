use crate::settings::{Locale, Settings, ThemeMode};
use serde::Serialize;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Loading,
    Timeout,
    Failed,
    Quitting,
    Complete,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub phase: Phase,
    pub splash_enabled: bool,
    pub locale: Locale,
    pub theme_mode: ThemeMode,
}

pub(super) struct Progress {
    pub settings: Settings,
    pub backend_done: bool,
    phase: Phase,
    deadline: Instant,
}

impl Progress {
    pub fn new(settings: Settings, now: Instant) -> Self {
        Self {
            settings,
            backend_done: false,
            phase: Phase::Loading,
            deadline: now + TIMEOUT,
        }
    }

    pub fn snapshot(&mut self, now: Instant) -> Snapshot {
        if self.phase == Phase::Loading && now >= self.deadline {
            self.phase = Phase::Timeout;
        }
        Snapshot {
            phase: self.phase,
            splash_enabled: self.settings.startup_splash,
            locale: self.settings.locale,
            theme_mode: self.settings.theme_mode,
        }
    }

    pub fn should_present(&mut self, now: Instant) -> bool {
        let snapshot = self.snapshot(now);
        matches!(
            snapshot.phase,
            Phase::Timeout | Phase::Failed | Phase::Quitting
        ) || (snapshot.phase == Phase::Loading && snapshot.splash_enabled)
    }

    pub fn continue_waiting(&mut self, now: Instant) {
        if self.phase == Phase::Timeout {
            self.phase = Phase::Loading;
            self.deadline = now + TIMEOUT;
        }
    }

    pub fn fail(&mut self) {
        if matches!(self.phase, Phase::Loading | Phase::Timeout) {
            self.phase = Phase::Failed;
        }
    }

    pub fn can_show(&self) -> bool {
        matches!(
            self.phase,
            Phase::Loading | Phase::Timeout | Phase::Complete
        )
    }

    pub fn complete(&mut self) -> bool {
        if !self.can_show() {
            return false;
        }
        self.phase = Phase::Complete;
        true
    }

    pub fn request_exit(&mut self) -> bool {
        if self.backend_done {
            return false;
        }
        self.phase = Phase::Quitting;
        true
    }

    pub fn quitting(&self) -> bool {
        self.phase == Phase::Quitting
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_startup_cannot_be_reopened_by_late_timeout_or_failure() {
        let now = Instant::now();
        let mut progress = Progress::new(Settings::default(), now);
        assert_eq!(progress.snapshot(now + TIMEOUT).phase, Phase::Timeout);
        assert!(progress.complete());
        progress.continue_waiting(now + TIMEOUT);
        progress.fail();
        assert!(!progress.should_present(now + TIMEOUT * 3));
        assert_eq!(progress.snapshot(now).phase, Phase::Complete);
    }

    #[test]
    fn continuing_rearms_timeout_without_recovering_a_failure() {
        let now = Instant::now();
        let mut progress = Progress::new(Settings::default(), now);
        progress.snapshot(now + TIMEOUT);
        progress.continue_waiting(now + TIMEOUT);
        assert_eq!(
            progress
                .snapshot(now + TIMEOUT * 2 - Duration::from_millis(1))
                .phase,
            Phase::Loading
        );
        assert_eq!(progress.snapshot(now + TIMEOUT * 2).phase, Phase::Timeout);
        progress.fail();
        progress.continue_waiting(now + TIMEOUT * 2);
        assert_eq!(progress.snapshot(now).phase, Phase::Failed);
        assert!(!progress.complete());
    }

    #[test]
    fn exit_during_backend_work_cannot_turn_into_a_ready_window() {
        let now = Instant::now();
        let mut progress = Progress::new(Settings::default(), now);
        assert!(progress.request_exit());
        progress.fail();
        progress.continue_waiting(now + TIMEOUT);
        progress.backend_done = true;
        assert!(progress.quitting());
        assert!(!progress.complete());
        assert!(!progress.request_exit());
    }
}
