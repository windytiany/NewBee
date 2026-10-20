#[cfg(test)]
use crate::artwork::track::Scan;
use crate::artwork::{
    model::ArtworkContent,
    track::{DirectoryPicture, Picture},
};
use lofty::{
    file::TaggedFileExt,
    picture::{MimeType, Picture as FilePicture, PictureType},
    tag::TagType,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(test)]
pub(crate) fn read_collection(audio: &Path) -> Scan {
    Scan {
        embedded: read_embedded_pictures(audio),
        directory: read_directory_pictures(audio),
    }
}

pub(crate) fn read_embedded_pictures(audio: &Path) -> Result<Vec<Picture>, String> {
    let file = super::read_file(audio)?;
    pictures_from_file(&file)
}

pub(super) fn populate_ape_pictures(
    path: &Path,
    file: &mut lofty::file::TaggedFile,
    options: lofty::config::ParseOptions,
) -> Result<(), String> {
    use lofty::prelude::AudioFile;
    if file.file_type() != lofty::file::FileType::Mpeg {
        return Ok(());
    }
    let Some(tag) = file.tag_mut(TagType::Ape) else {
        return Ok(());
    };
    let mut source = fs::File::open(path).map_err(|error| error.to_string())?;
    let native = lofty::mpeg::MpegFile::read_from(&mut source, options)
        .map_err(|error| error.to_string())?;
    let Some(ape) = native.ape() else {
        return Ok(());
    };
    for item in ape {
        if !item.key().to_ascii_lowercase().starts_with("cover art (") {
            continue;
        }
        if !lofty::ape::APE_PICTURE_TYPES
            .iter()
            .any(|key| key.eq_ignore_ascii_case(item.key()))
        {
            return Err(format!("不支持的 APE 图片类型：{}", item.key()));
        }
        let lofty::tag::ItemValue::Binary(bytes) = item.value() else {
            return Err(format!("无效的 APE 图片条目：{}", item.key()));
        };
        let key = lofty::ape::APE_PICTURE_TYPES
            .iter()
            .find(|key| key.eq_ignore_ascii_case(item.key()))
            .ok_or_else(|| "不支持的 APE 图片类型".to_owned())?;
        tag.push_picture(
            FilePicture::from_ape_bytes(key, bytes)
                .map_err(|error| format!("读取 APE 图片失败：{error}"))?,
        );
    }
    Ok(())
}

pub(super) fn prepare_pictures(
    pictures: &[Picture],
    tag_type: TagType,
) -> Result<Vec<FilePicture>, String> {
    if !matches!(
        tag_type,
        TagType::Id3v2 | TagType::Mp4Ilst | TagType::VorbisComments
    ) {
        return Err("此标签格式不支持内嵌图片".to_owned());
    }
    let mut prepared = Vec::with_capacity(pictures.len());
    for (index, picture) in pictures.iter().enumerate() {
        if picture.picture_type > 20 {
            return Err(format!("不支持的图片类型：{}", picture.picture_type));
        }
        let mut native = super::cover_picture(&picture.content.image)?;
        if native.mime_type().map(ToString::to_string).as_deref()
            != Some(picture.content.mime_type.as_str())
        {
            return Err("图片 MIME 类型与内容不一致".to_owned());
        }
        let picture_type = PictureType::from_u8(picture.picture_type);
        if tag_type == TagType::Mp4Ilst {
            if picture_type != PictureType::Other {
                return Err("MP4 仅支持 Other（0）图片类型".to_owned());
            }
            if !matches!(
                native.mime_type(),
                Some(MimeType::Png | MimeType::Jpeg | MimeType::Gif | MimeType::Bmp)
            ) {
                return Err("MP4 不支持此图片格式".to_owned());
            }
        } else if matches!(picture_type, PictureType::Icon | PictureType::OtherIcon) {
            if pictures[..index]
                .iter()
                .any(|other| other.picture_type == picture.picture_type)
            {
                return Err(format!(
                    "图片类型 {} 只能包含一张图片",
                    picture.picture_type
                ));
            }
            if picture_type == PictureType::Icon {
                let dimensions =
                    image::ImageReader::new(std::io::Cursor::new(&picture.content.image))
                        .with_guessed_format()
                        .map_err(|error| error.to_string())?
                        .into_dimensions()
                        .map_err(|error| error.to_string())?;
                if native.mime_type() != Some(&MimeType::Png) || dimensions != (32, 32) {
                    return Err("Icon（1）图片必须为 32×32 PNG".to_owned());
                }
            }
        }
        native.set_pic_type(picture_type);
        // Lofty's ID3 conversion deduplicates identical APIC frames. Distinguish
        // repeated collection entries without changing their content or type.
        if tag_type == TagType::Id3v2
            && pictures[..index]
                .iter()
                .any(|other| same_picture(other, picture))
        {
            native.set_description(Some(index.to_string()));
        }
        prepared.push(native);
    }
    Ok(prepared)
}

pub(super) fn verify_pictures(
    file: &lofty::file::TaggedFile,
    expected: &[Picture],
) -> Result<(), String> {
    let actual = pictures_from_file(file)?;
    if actual.len() != expected.len()
        || !actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| same_picture(actual, expected))
    {
        return Err("图片集合回读内容或类型不一致，原文件未修改".to_owned());
    }
    Ok(())
}

fn same_picture(left: &Picture, right: &Picture) -> bool {
    left.picture_type == right.picture_type
        && left.content.mime_type == right.content.mime_type
        && left.content.image == right.content.image
}

pub(super) fn pictures_from_file(file: &lofty::file::TaggedFile) -> Result<Vec<Picture>, String> {
    let mut pictures = Vec::new();
    for tag in file.tags() {
        for picture in tag.pictures() {
            let mime_type = picture
                .mime_type()
                .map(ToString::to_string)
                .ok_or_else(|| "embedded artwork has no recognized MIME type".to_owned())?;
            pictures.push(Picture {
                content: ArtworkContent {
                    mime_type,
                    image: picture.data().to_vec(),
                },
                picture_type: picture.pic_type().as_u8(),
            });
        }
    }
    Ok(pictures)
}

const COVER_NAMES: &[&str] = &["cover.jpg", "cover.png", "folder.jpg", "folder.png"];

pub(crate) fn read_directory_pictures(audio: &Path) -> Result<Vec<DirectoryPicture>, String> {
    Ok(directory_picture_paths(audio)?
        .into_iter()
        .map(|path| DirectoryPicture {
            content: read_directory_picture(&path),
            path: path.to_string_lossy().into_owned(),
        })
        .collect())
}

pub(crate) fn directory_picture_paths(audio: &Path) -> Result<Vec<PathBuf>, String> {
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
    Ok(candidates.into_iter().map(|(_, path)| path).collect())
}

fn read_directory_picture(path: &Path) -> Result<ArtworkContent, String> {
    decode_directory_picture(path, read_directory_bytes(path)?)
}

pub(crate) fn read_directory_bytes(path: &Path) -> Result<Vec<u8>, String> {
    #[cfg(test)]
    crate::metadata::files::access::record(path, "directory artwork read");
    fs::read(path).map_err(|error| format!("Directory artwork '{}': {error}", path.display()))
}

pub(crate) fn decode_directory_picture(
    path: &Path,
    data: Vec<u8>,
) -> Result<ArtworkContent, String> {
    #[cfg(test)]
    crate::metadata::files::access::record(path, "directory artwork decode");
    let format = image::guess_format(&data)
        .map_err(|error| format!("Directory artwork '{}': {error}", path.display()))?;
    image::load_from_memory_with_format(&data, format)
        .map_err(|error| format!("Directory artwork '{}': {error}", path.display()))?;
    Ok(ArtworkContent {
        mime_type: format.to_mime_type().into(),
        image: data,
    })
}
