use serde::Serialize;
use std::path::Path;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileTrack {
    id: String,
    #[serde(flatten)]
    pub(crate) snapshot: crate::database::model::TrackWriteInput,
}

impl FileTrack {
    pub(crate) fn unconfirmed(path: &str) -> Self {
        Self {
            id: path.to_owned(),
            snapshot: crate::database::model::TrackWriteInput {
                path: path.to_owned(),
                title: Path::new(path)
                    .file_stem()
                    .map(|name| name.to_string_lossy().into_owned()),
                artist: None,
                album: None,
                album_artist: None,
                release_date: None,
                disc_number: None,
                track_number: None,
                disc_total: None,
                track_total: None,
                duration_ms: None,
                codec: None,
                sample_rate_hz: None,
                bitrate_kbps: None,
                channels: None,
                artwork: None,
                editing: None,
                lyrics: None,
            },
        }
    }
    pub(crate) fn read(path: &str) -> Result<Self, String> {
        let snapshot =
            super::read_track(Path::new(path))?.ok_or_else(|| "不支持的音频文件".to_owned())?;
        Ok(Self {
            id: path.to_owned(),
            snapshot,
        })
    }
}
