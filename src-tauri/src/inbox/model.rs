use crate::tracks::model::TrackDetails;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileResult {
    pub(super) track_id: Option<i64>,
    pub(super) path: String,
    pub(super) success: bool,
    pub(super) skipped: bool,
    pub(super) error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxRead {
    pub(super) tracks: Vec<InboxTrack>,
    pub(super) failures: Vec<FileResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InboxTrack {
    #[serde(flatten)]
    pub(super) track: TrackDetails,
    pub(super) added_at: i64,
}
