use serde::{Deserialize, Serialize};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibraryDirectory {
    pub(crate) id: i64,
    pub(crate) path: String,
    pub(crate) display_path: String,
}
