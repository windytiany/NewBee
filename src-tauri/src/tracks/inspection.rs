use crate::{artwork::track::Scan, database::Database, metadata::files};
use std::path::Path;

use super::model::Snapshot;

/// Inspect every source before publishing any part of a snapshot.
pub(crate) fn inspect(database: &Database, path: &Path) -> Result<Snapshot, String> {
    inspect_with_directory(database, path, || {
        files::artwork::read_directory_pictures(path)
    })
}

pub(crate) fn inspect_with_directory(
    database: &Database,
    path: &Path,
    directory: impl FnOnce() -> Result<Vec<crate::artwork::track::DirectoryPicture>, String>,
) -> Result<Snapshot, String> {
    let outcome = (|| {
        let snapshot =
            files::read_track_collection(path)?.ok_or_else(|| "文件格式不支持快照".to_owned())?;
        let artwork = Scan {
            embedded: snapshot.embedded,
            directory: directory(),
        };
        let issues = artwork.issues();
        if !issues.is_empty() {
            return Err(format!("读取图片失败：{}", issues.join("; ")));
        }
        for picture in artwork.embedded.as_ref().map_err(Clone::clone)? {
            validate(&picture.content)?;
        }
        let mut linked = Vec::new();
        for (id, source) in database.linked_artwork_sources(&snapshot.track.path)? {
            let content = crate::artwork::track::linked::read(&source)?;
            validate(&content)?;
            linked.push((id, content));
        }
        Ok(Snapshot {
            track: snapshot.track,
            artwork,
            linked,
        })
    })();
    if let Err(error) = &outcome {
        log::debug!(
            "Full scan '{}' failed during inspection: {error}",
            path.display()
        );
    }
    outcome
}

fn validate(content: &crate::artwork::model::ArtworkContent) -> Result<(), String> {
    let format =
        image::guess_format(&content.image).map_err(|error| format!("识别图片失败：{error}"))?;
    if format.to_mime_type() != content.mime_type {
        return Err("图片 MIME 类型与内容不一致".to_owned());
    }
    image::load_from_memory_with_format(&content.image, format)
        .map_err(|error| format!("解码图片失败：{error}"))?;
    Ok(())
}
