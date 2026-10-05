pub(crate) mod download;
pub(crate) mod local;
mod providers;

pub use local::{parse_embedded_lyrics, LyricLine, TrackLyrics};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LyricsProvider {
    Netease,
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
