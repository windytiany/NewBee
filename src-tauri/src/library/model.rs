use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub(in crate::library) added: u64,
    pub(in crate::library) updated: u64,
    pub(in crate::library) skipped: u64,
    pub(in crate::library) failed: u64,
    #[serde(skip)]
    failures: crate::logging::aggregation::Failures,
    #[serde(skip)]
    failed_paths: std::collections::HashSet<std::path::PathBuf>,
}

impl Default for ImportResult {
    fn default() -> Self {
        Self {
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            failures: crate::logging::aggregation::Failures::new("library.import"),
            failed_paths: std::collections::HashSet::new(),
        }
    }
}

impl ImportResult {
    pub(in crate::library) fn record_failure(&mut self, path: &Path, stage: &str, error: &str) {
        if self.failed_paths.insert(path.to_owned()) {
            self.failed += 1;
        }
        self.failures.record(stage, error, &path.to_string_lossy());
    }

    pub(in crate::library) fn has_failures_in(&self, root: &Path) -> bool {
        self.failed_paths.iter().any(|path| path.starts_with(root))
    }

    pub(in crate::library) fn flush_failures(&mut self) {
        self.failures.flush();
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryGrouping {
    AlbumArtist,
    Artist,
}

impl LibraryGrouping {
    pub(crate) fn column(self) -> &'static str {
        match self {
            Self::AlbumArtist => "album_artist",
            Self::Artist => "artist",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryGroup {
    pub(crate) grouping: LibraryGrouping,
    pub(crate) artist: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSummary {
    pub(crate) artist: Option<String>,
    pub(crate) album_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub(crate) album_artist: Option<String>,
    pub(crate) album: Option<String>,
    pub(crate) year: Option<i64>,
}
