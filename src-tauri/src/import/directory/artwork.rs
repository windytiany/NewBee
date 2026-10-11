use crate::database::ArtworkContent;
use std::{
    fs,
    path::{Path, PathBuf},
};

const COVER_NAMES: &[&str] = &["cover.jpg", "cover.png", "folder.jpg", "folder.png"];

pub(in crate::import) fn read_directory_cover(
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
