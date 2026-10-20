pub(crate) mod artwork;
mod formats;
pub(crate) mod lyrics;
mod replacement;
pub(crate) mod replaygain;
mod snapshot;
mod tags;

use super::model::{EditingSnapshot, MetadataChange, MetadataField};
use lofty::config::ParseOptions;
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::picture::{Picture, PictureType};
use lofty::probe::Probe;
pub(crate) use snapshot::{read_track, read_track_collection, read_track_metadata};
use std::{fs, path::Path};
use tags::{editing_tag, writable_fields};

pub(crate) const MAX_COVER_BYTES: usize = 20 * 1024 * 1024;

fn read_file(path: &Path) -> Result<TaggedFile, String> {
    read_file_with_options(path, ParseOptions::default())
}

fn read_file_with_options(path: &Path, options: ParseOptions) -> Result<TaggedFile, String> {
    #[cfg(test)]
    access::record(path, "parse");
    let mut file = Probe::open(path)
        .map_err(|error| format!("读取文件标签失败：{error}"))?
        .guess_file_type()
        .map_err(|error| format!("识别文件格式失败：{error}"))?
        .options(options)
        .read()
        .map_err(|error| format!("读取文件标签失败：{error}"))?;
    artwork::populate_ape_pictures(path, &mut file, options)?;
    Ok(file)
}

fn is_supported_file_type(file_type: FileType) -> bool {
    matches!(
        file_type,
        FileType::Mpeg
            | FileType::Aac
            | FileType::Mp4
            | FileType::Vorbis
            | FileType::Flac
            | FileType::Wav
    )
}

#[cfg(test)]
pub(super) fn inspect_file(path: &Path) -> Result<EditingSnapshot, String> {
    let readonly = file_metadata(path)
        .map_err(|error| error.to_string())?
        .permissions()
        .readonly();
    let file = read_file(path)?;
    Ok(metadata_from_file(&file, readonly))
}

fn metadata_from_file(file: &TaggedFile, readonly: bool) -> EditingSnapshot {
    let tag = editing_tag(file);
    let writable_fields = if readonly {
        Vec::new()
    } else {
        writable_fields(file, &tag)
    };
    let issue = if readonly {
        Some("文件为只读".to_owned())
    } else if writable_fields.is_empty() {
        Some("此文件格式不支持标签写入".to_owned())
    } else {
        None
    };
    EditingSnapshot {
        file_type: format!("{:?}", file.file_type()),
        tag_types: file
            .tags()
            .iter()
            .map(|tag| format!("{:?}", tag.tag_type()))
            .collect(),
        writable_fields,
        issue,
        values: MetadataField::ALL
            .into_iter()
            .filter_map(|field| {
                tag.get_string(field.key(tag.tag_type()))
                    .map(|value| (field, value.to_owned()))
            })
            .collect(),
    }
}

/// Lyric replacement also clears secondary lyric fields. Failed checks never touch the original.
pub(crate) fn write_file(path: &Path, changes: &[MetadataChange]) -> Result<(), String> {
    write_file_with_cover(path, changes, None)
}

pub(crate) fn cover_picture(data: &[u8]) -> Result<Picture, String> {
    if data.is_empty() || data.len() > MAX_COVER_BYTES {
        return Err("封面为空或超过 20 MiB".to_owned());
    }
    let mut picture = Picture::from_reader(&mut std::io::Cursor::new(data))
        .map_err(|error| format!("无效封面图片：{error}"))?;
    picture.set_pic_type(PictureType::CoverFront);
    Ok(picture)
}

pub(crate) enum CoverAction<'a> {
    Replace(&'a Picture),
    Delete,
}

pub(crate) fn write_file_with_cover(
    path: &Path,
    changes: &[MetadataChange],
    cover: Option<CoverAction<'_>>,
) -> Result<(), String> {
    let pictures = match cover {
        Some(CoverAction::Replace(picture)) => {
            let picture_type = if read_file(path)?.file_type() == FileType::Mp4 {
                PictureType::Other.as_u8()
            } else {
                picture.pic_type().as_u8()
            };
            Some(vec![crate::artwork::track::Picture {
                content: crate::artwork::model::ArtworkContent {
                    mime_type: picture
                        .mime_type()
                        .map(ToString::to_string)
                        .ok_or_else(|| "封面缺少 MIME 类型".to_owned())?,
                    image: picture.data().to_vec(),
                },
                picture_type,
            }])
        }
        Some(CoverAction::Delete) => Some(Vec::new()),
        None => None,
    };
    write_file_with_pictures(path, changes, pictures.as_deref())
}

pub(crate) fn write_file_with_pictures(
    path: &Path,
    changes: &[MetadataChange],
    pictures: Option<&[crate::artwork::track::Picture]>,
) -> Result<(), String> {
    let metadata = file_metadata(path).map_err(|error| error.to_string())?;
    if metadata.permissions().readonly() {
        return Err("文件为只读".to_owned());
    }
    let original = read_file(path)?;
    if !is_supported_file_type(original.file_type()) {
        return Err("此文件格式不支持标签写入".to_owned());
    }
    let Some(prepared) = tags::Prepared::new(&original, changes, pictures)? else {
        return Ok(());
    };
    replacement::replace(
        path,
        &metadata,
        |copy, destination| {
            prepared.write(destination, original.file_type(), pictures.is_some())?;
            if original.file_type() == FileType::Aac {
                formats::aac::verify(copy, destination)?;
            }
            Ok(())
        },
        |copy| prepared.verify(&read_file(copy)?, changes, pictures),
    )
}

#[cfg(test)]
mod tests;

fn file_metadata(path: &Path) -> std::io::Result<std::fs::Metadata> {
    #[cfg(test)]
    access::record(path, "metadata");
    fs::metadata(path)
}

#[cfg(test)]
pub(crate) mod access {
    use std::{
        path::{Path, PathBuf},
        sync::Mutex,
    };
    static ACCESSES: Mutex<Vec<(PathBuf, &'static str)>> = Mutex::new(Vec::new());
    pub(crate) fn record(path: &Path, kind: &'static str) {
        ACCESSES.lock().unwrap().push((path.to_owned(), kind));
    }
    pub(crate) fn take(root: &Path) -> Vec<(PathBuf, &'static str)> {
        let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
        let mut all = ACCESSES.lock().unwrap();
        let mut selected = Vec::new();
        all.retain(|(path, kind)| {
            if path.starts_with(root) || path.starts_with(&canonical_root) {
                selected.push((path.clone(), *kind));
                false
            } else {
                true
            }
        });
        selected
    }
}
