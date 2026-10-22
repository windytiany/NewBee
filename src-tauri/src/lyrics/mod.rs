pub(crate) mod batch;
pub(crate) mod download;
pub(crate) mod embedded;
pub mod model;
pub(crate) mod parsing;
mod providers;
pub(crate) mod sidecar;
pub(crate) use providers::NeteaseLyricsMode;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LyricsProvider {
    Netease,
}

impl LyricsProvider {
    pub(crate) fn identifier(self) -> &'static str {
        match self {
            Self::Netease => "netease",
        }
    }
}

pub(crate) fn default_providers() -> Vec<LyricsProvider> {
    vec![LyricsProvider::Netease]
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyricsCandidate {
    provider: LyricsProvider,
    id: i64,
    title: String,
    artists: Vec<String>,
    album: String,
    duration_ms: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyricsSearchResults {
    candidates: Vec<LyricsCandidate>,
    next_offset: Option<u32>,
}
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum LyricsContent {
    Available { text: String },
    Instrumental,
    Missing,
}
