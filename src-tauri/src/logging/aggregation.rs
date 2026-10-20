use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    time::{Duration, Instant},
};

const MAX_GROUPS: usize = 128;
const SAMPLE_COUNT: usize = 3;

struct Group {
    attempts: usize,
    subjects: HashSet<String>,
    samples: Vec<String>,
    reported: usize,
    last_report: Instant,
}

/// Owned by a single batch, not the global logger. Exact reasons are retained:
/// callers with typed errors may provide a stable code, but paths are never stripped heuristically.
pub(crate) struct Failures {
    module: &'static str,
    groups: BTreeMap<(String, String), Group>,
}

impl Failures {
    pub(crate) fn new(module: &'static str) -> Self {
        Self {
            module,
            groups: BTreeMap::new(),
        }
    }

    pub(crate) fn record(&mut self, stage: &str, reason: &str, subject: &str) {
        self.observe(stage, reason, subject, Instant::now());
    }

    fn observe(&mut self, stage: &str, reason: &str, subject: &str, now: Instant) {
        let key = (stage.to_owned(), reason.to_owned());
        if self.groups.len() >= MAX_GROUPS && !self.groups.contains_key(&key) {
            self.flush();
            self.groups.clear();
        }
        let group = self.groups.entry(key.clone()).or_insert_with(|| Group {
            attempts: 0,
            subjects: HashSet::new(),
            samples: vec![],
            reported: 0,
            last_report: now,
        });
        group.attempts += 1;
        if group.subjects.insert(subject.to_owned()) && group.samples.len() < SAMPLE_COUNT {
            group.samples.push(subject.to_owned());
        }
        if group.reported == 0 || now.duration_since(group.last_report) >= Duration::from_secs(30) {
            Self::emit(
                self.module,
                &key,
                group,
                if group.reported == 0 {
                    "first"
                } else {
                    "progress"
                },
            );
            group.last_report = now;
        }
        log::debug!(
            "{}",
            json!({"event":"batch_item_failed", "stage":stage, "error":reason, "path":subject})
        );
    }

    fn summary(key: &(String, String), group: &Group, phase: &str) -> Value {
        json!({"event":"batch_failure", "stage":key.0, "error":key.1,
            "phase":phase, "attempts":group.attempts, "affected":group.subjects.len(),
            "sinceLastReport":group.attempts - group.reported, "samples":group.samples,
            "omittedSamples":group.subjects.len().saturating_sub(group.samples.len())})
    }

    fn emit(module: &str, key: &(String, String), group: &mut Group, phase: &str) {
        let mut summary = Self::summary(key, group, phase);
        summary["module"] = json!(module);
        log::warn!("{summary}");
        group.reported = group.attempts;
    }

    pub(crate) fn flush(&mut self) {
        for (key, group) in &mut self.groups {
            if group.reported < group.attempts {
                Self::emit(self.module, key, group, "summary");
            }
        }
    }
}

impl Drop for Failures {
    fn drop(&mut self) {
        self.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_cross_track_errors_but_counts_retries_separately() {
        let mut failures = Failures::new("library.import");
        for index in 0..42 {
            failures.record(
                "scan",
                "permission denied",
                &format!("D:/Music/{index}.flac"),
            );
        }
        failures.record("scan", "permission denied", "D:/Music/0.flac");
        failures.record("save", "permission denied", "D:/Music/0.flac");
        failures.record("scan", "disk full", "D:/Music/0.flac");
        assert_eq!(failures.groups.len(), 3);
        let key = ("scan".into(), "permission denied".into());
        let group = &failures.groups[&key];
        let summary = Failures::summary(&key, group, "summary");
        assert_eq!(summary["attempts"], 43);
        assert_eq!(summary["affected"], 42);
        assert_eq!(summary["omittedSamples"], 39);
        assert_eq!(summary["samples"].as_array().unwrap().len(), 3);
        assert_eq!(group.reported, 1);
    }

    #[test]
    fn reports_first_periodic_and_final_counts_without_repeating_flush() {
        let mut failures = Failures::new("library.import");
        let now = Instant::now();
        failures.observe("scan", "bad file", "a", now);
        failures.observe("scan", "bad file", "b", now + Duration::from_secs(1));
        let key = ("scan".into(), "bad file".into());
        assert_eq!(failures.groups[&key].reported, 1);
        failures.observe("scan", "bad file", "c", now + Duration::from_secs(30));
        assert_eq!(failures.groups[&key].reported, 3);
        failures.observe("scan", "bad file", "d", now + Duration::from_secs(31));
        failures.flush();
        assert_eq!(failures.groups[&key].reported, 4);
        failures.flush();
        assert_eq!(failures.groups[&key].reported, 4);
    }
}
