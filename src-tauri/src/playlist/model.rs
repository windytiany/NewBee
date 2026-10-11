use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) track_count: i64,
    pub(crate) cover_track_id: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistTrackSummary {
    pub(crate) playlist_item_id: i64,
    pub(crate) track_id: i64,
    pub(crate) title: Option<String>,
    pub(crate) artist: Option<String>,
    pub(crate) album: Option<String>,
    pub(crate) duration_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum PlaylistReorderError {
    ItemSetMismatch { message: String },
    Failed { message: String },
}

impl From<String> for PlaylistReorderError {
    fn from(message: String) -> Self {
        Self::Failed { message }
    }
}
