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
    pub(crate) fn read(path: &str) -> Result<Self, String> {
        let snapshot =
            super::read_track(Path::new(path))?.ok_or_else(|| "不支持的音频文件".to_owned())?;
        Ok(Self {
            id: path.to_owned(),
            snapshot,
        })
    }
}
