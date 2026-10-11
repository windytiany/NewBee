use crate::lyrics::parsing::select_lyrics_candidate;
use lofty::file::TaggedFileExt;
use lofty::tag::ItemKey;

pub(crate) fn embedded_lyrics_text(tagged_file: &lofty::file::TaggedFile) -> Option<&str> {
    let candidates = tagged_file.tags().iter().flat_map(|tag| {
        [ItemKey::Lyrics, ItemKey::UnsyncLyrics]
            .into_iter()
            .flat_map(move |key| tag.get_strings(key))
    });
    select_lyrics_candidate(candidates)
}
