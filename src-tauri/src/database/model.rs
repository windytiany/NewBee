#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackWriteInput {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub release_date: Option<String>,
    pub disc_number: Option<i64>,
    pub track_number: Option<i64>,
    pub disc_total: Option<i64>,
    pub track_total: Option<i64>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub sample_rate_hz: Option<i64>,
    pub bitrate_kbps: Option<i64>,
    pub channels: Option<i64>,
    #[serde(skip)]
    pub(crate) editing: Option<crate::metadata::model::EditingSnapshot>,
    pub lyrics: Option<String>,
}

pub enum TrackWriteOutcome {
    Added,
    Updated,
}
