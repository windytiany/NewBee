use crate::artwork::model::ArtworkContent;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) fn read_embedded_cover(audio: &Path) -> Result<Option<ArtworkContent>, String> {
    use lofty::file::TaggedFileExt;
    let file = super::read_file(audio)?;
    let editing = super::editing_tag(&file);
    if let Some(cover) = super::snapshot::read_artwork(&editing)? {
        return Ok(Some(cover));
    }
    for tag in file
        .tags()
        .iter()
        .filter(|tag| tag.tag_type() != editing.tag_type())
    {
        if let Some(cover) = super::snapshot::read_artwork(tag)? {
            return Ok(Some(cover));
        }
    }
    Ok(None)
}

const COVER_NAMES: &[&str] = &["cover.jpg", "cover.png", "folder.jpg", "folder.png"];

pub(crate) fn read_directory_cover(
    audio: &Path,
) -> Result<Option<(ArtworkContent, PathBuf)>, String> {
    let directory = audio.parent().ok_or("Audio has no parent directory")?;
    #[cfg(test)]
    crate::metadata::files::access::record(directory, "directory artwork lookup");
    let mut candidates = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Directory artwork lookup failed: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Directory artwork lookup failed: {error}"))?;
        if let Some(rank) = COVER_NAMES.iter().position(|name| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        }) {
            if entry
                .file_type()
                .map_err(|error| {
                    format!("Directory artwork '{}': {error}", entry.path().display())
                })?
                .is_dir()
            {
                continue;
            }
            candidates.push((rank, entry.path()));
        }
    }
    candidates.sort();
    let Some((_, path)) = candidates.first() else {
        return Ok(None);
    };
    #[cfg(test)]
    crate::metadata::files::access::record(path, "directory artwork read");
    let data = fs::read(path)
        .map_err(|error| format!("Directory artwork '{}': {error}", path.display()))?;
    let format = image::guess_format(&data)
        .map_err(|error| format!("Directory artwork '{}': {error}", path.display()))?;
    image::load_from_memory_with_format(&data, format)
        .map_err(|error| format!("Directory artwork '{}': {error}", path.display()))?;
    Ok(Some((
        ArtworkContent {
            mime_type: format.to_mime_type().into(),
            image: data,
        },
        path.clone(),
    )))
}
