use crate::{
    artwork::collection::Scan,
    database::{model::TrackWriteInput, Database},
    metadata::files,
};
use std::path::Path;

pub(crate) struct Snapshot {
    pub(crate) track: TrackWriteInput,
    pub(crate) artwork: Scan,
    pub(crate) linked: Vec<(i64, crate::artwork::model::ArtworkContent)>,
}

/// Inspect every source before publishing any part of a snapshot.
pub(crate) fn scan(database: &Database, path: &Path) -> Result<Snapshot, String> {
    scan_with_directory(database, path, || {
        files::artwork::read_directory_pictures(path)
    })
}

pub(crate) fn scan_with_directory(
    database: &Database,
    path: &Path,
    directory: impl FnOnce() -> Result<Vec<crate::artwork::collection::DirectoryPicture>, String>,
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
            let content = crate::artwork::collection::linked::read(&source)?;
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

pub(crate) fn persist(
    transaction: &rusqlite::Transaction<'_>,
    snapshot: &Snapshot,
) -> Result<i64, String> {
    let id = crate::database::tracks::persist_track(
        transaction,
        &snapshot.track,
        Some(&snapshot.artwork),
    )?;
    for (artwork_id, content) in &snapshot.linked {
        crate::database::artwork::update_linked_snapshot(transaction, id, *artwork_id, content)?;
    }
    Ok(id)
}
