mod netease;
pub(crate) use netease::NeteaseLyricsMode;

use super::{LyricsCandidate, LyricsContent, LyricsProvider, LyricsSearchResults};
use crate::settings::Settings;

pub(crate) struct LyricsProviderSet {
    enabled: Vec<LyricsProvider>,
    netease_mode: NeteaseLyricsMode,
}

impl LyricsProviderSet {
    pub(crate) fn from_settings(settings: Settings) -> Result<Self, String> {
        if settings.lyrics_providers.is_empty() {
            return Err("请先在设置中启用歌词来源".to_owned());
        }
        Ok(Self {
            enabled: settings.lyrics_providers,
            netease_mode: settings.netease_lyrics_mode,
        })
    }

    pub(crate) fn enabled(&self) -> &[LyricsProvider] {
        &self.enabled
    }

    pub(crate) fn lyrics(
        &self,
        provider: LyricsProvider,
        id: i64,
    ) -> Result<LyricsContent, String> {
        match provider {
            LyricsProvider::Netease => netease::lyrics(id, self.netease_mode),
        }
    }
}

pub(super) fn search(
    provider: LyricsProvider,
    query: &str,
    offset: u32,
) -> Result<LyricsSearchResults, String> {
    match provider {
        LyricsProvider::Netease => netease::search(query, offset),
    }
}
