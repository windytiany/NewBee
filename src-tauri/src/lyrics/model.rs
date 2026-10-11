use serde::Serialize;

pub(crate) struct LyricsSnapshot {
    pub(crate) text: Option<String>,
    pub(crate) no_lyrics: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyricsDownloadTarget {
    pub(crate) id: i64,
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
    pub(crate) has_lyrics: bool,
    pub(crate) no_lyrics: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub start_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TrackLyrics {
    None,
    Instrumental,
    Plain { text: String },
    Synced { lines: Vec<LyricLine> },
}
