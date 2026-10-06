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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_modes_are_preserved_in_provider_configuration() {
        for netease_lyrics_mode in [
            NeteaseLyricsMode::Original,
            NeteaseLyricsMode::Translated,
            NeteaseLyricsMode::Bilingual,
        ] {
            let settings = Settings {
                lyrics_providers: vec![LyricsProvider::Netease],
                netease_lyrics_mode,
                ..Settings::default()
            };
            let providers = LyricsProviderSet::from_settings(settings).unwrap();

            assert_eq!(providers.enabled(), &[LyricsProvider::Netease]);
            assert_eq!(providers.netease_mode, netease_lyrics_mode);
        }
    }

    #[test]
    fn default_settings_configure_original_lyrics() {
        let providers = LyricsProviderSet::from_settings(Settings::default()).unwrap();

        assert_eq!(providers.enabled(), &[LyricsProvider::Netease]);
        assert_eq!(providers.netease_mode, NeteaseLyricsMode::Original);
    }

    #[test]
    fn provider_configuration_is_an_owned_settings_snapshot() {
        let mut settings = Settings {
            netease_lyrics_mode: NeteaseLyricsMode::Translated,
            ..Settings::default()
        };
        let providers = LyricsProviderSet::from_settings(settings.clone()).unwrap();
        settings.netease_lyrics_mode = NeteaseLyricsMode::Bilingual;
        let updated = LyricsProviderSet::from_settings(settings.clone()).unwrap();
        settings.lyrics_providers.clear();

        assert_eq!(providers.enabled(), &[LyricsProvider::Netease]);
        assert_eq!(providers.netease_mode, NeteaseLyricsMode::Translated);
        assert_eq!(updated.enabled(), &[LyricsProvider::Netease]);
        assert_eq!(updated.netease_mode, NeteaseLyricsMode::Bilingual);
        assert!(LyricsProviderSet::from_settings(settings).is_err());
    }

    #[test]
    fn disabled_providers_are_rejected_regardless_of_content_mode() {
        for netease_lyrics_mode in [
            NeteaseLyricsMode::Original,
            NeteaseLyricsMode::Translated,
            NeteaseLyricsMode::Bilingual,
        ] {
            let settings = Settings {
                lyrics_providers: vec![],
                netease_lyrics_mode,
                ..Settings::default()
            };
            assert_eq!(
                LyricsProviderSet::from_settings(settings).err().as_deref(),
                Some("请先在设置中启用歌词来源")
            );
        }
    }
}
