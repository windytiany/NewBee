mod netease;

use super::{LyricsCandidate, LyricsContent, LyricsProvider, LyricsSearchResults};

pub(super) fn search(
    provider: LyricsProvider,
    query: &str,
    offset: u32,
) -> Result<LyricsSearchResults, String> {
    match provider {
        LyricsProvider::Netease => netease::search(query, offset),
    }
}

pub(super) fn lyrics(provider: LyricsProvider, id: i64) -> Result<LyricsContent, String> {
    match provider {
        LyricsProvider::Netease => netease::lyrics(id),
    }
}
