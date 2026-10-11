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
pub struct TrackSummary {
    pub(crate) disc_number: Option<i64>,
    pub(crate) track_number: Option<i64>,
    pub(crate) id: i64,
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
    pub(crate) album: Option<String>,
    pub(crate) duration_ms: Option<i64>,
}

pub(crate) struct TrackPlaybackInfo {
    pub(crate) path: String,
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDetails {
    pub(crate) id: i64,
    pub(crate) path: String,
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
    pub(crate) album: Option<String>,
    pub(crate) album_artist: Option<String>,
    pub(crate) release_date: Option<String>,
    pub(crate) disc_number: Option<i64>,
    pub(crate) track_number: Option<i64>,
    pub(crate) disc_total: Option<i64>,
    pub(crate) track_total: Option<i64>,
    pub(crate) duration_ms: Option<i64>,
    pub(crate) codec: Option<String>,
    pub(crate) sample_rate_hz: Option<i64>,
    pub(crate) bitrate_kbps: Option<i64>,
    pub(crate) channels: Option<i64>,
}

impl TrackDetails {
    pub(crate) fn path(&self) -> &str {
        &self.path
    }

    pub(crate) fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }
    pub(crate) fn artist(&self) -> Option<&str> {
        self.artist.as_deref()
    }
    pub(crate) fn album(&self) -> Option<&str> {
        self.album.as_deref()
    }
    pub(crate) fn duration_ms(&self) -> Option<i64> {
        self.duration_ms
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicLibraryDirectory {
    pub(crate) id: i64,
    pub(crate) path: String,
    pub(crate) display_path: String,
}
