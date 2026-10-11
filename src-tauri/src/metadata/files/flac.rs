use lofty::{
    config::{ParseOptions, WriteOptions},
    id3::v2::{Frame, Id3v2Tag},
    io::FileLike,
    prelude::*,
    tag::{Tag, TagType},
};
use std::{fs::File, io::Seek};

/// Only explicit cover edits may rebuild FLAC's read-only ID3 prefix.
/// Preserve native non-picture frames, including format-specific data, or fail safely.
pub(super) fn write_tag(file: &mut File, expected: &Tag) -> Result<(), String> {
    file.rewind().map_err(|error| error.to_string())?;
    let mut native = lofty::flac::FlacFile::read_from(file, ParseOptions::default())
        .map_err(|error| error.to_string())?
        .remove_id3v2()
        .ok_or_else(|| "FLAC 前置 ID3 不存在".to_owned())?;
    native.retain(|frame| !matches!(frame, Frame::Picture(_)));
    let requested = Id3v2Tag::from(expected.clone());
    if !same_frames(&native, &requested) {
        return Err("FLAC 前置 ID3 只允许移除图片，不能可靠保留的数据阻止保存".to_owned());
    }
    let options = WriteOptions::default().preferred_padding(0);
    let mut bytes = Vec::new();
    native
        .dump_to(&mut bytes, options)
        .map_err(|error| error.to_string())?;
    file.rewind().map_err(|error| error.to_string())?;
    TagType::Id3v2
        .remove_from(file, options)
        .map_err(|error| error.to_string())?;
    file.splice(0..0, &bytes)
        .map_err(|error| error.to_string())?;
    file.rewind().map_err(|error| error.to_string())?;
    let written = lofty::flac::FlacFile::read_from(file, ParseOptions::default())
        .map_err(|error| error.to_string())?;
    let empty = Id3v2Tag::new();
    if !same_frames(&native, written.id3v2().unwrap_or(&empty)) {
        return Err("FLAC 前置 ID3 的非图片数据回读不一致，原文件未修改".to_owned());
    }
    Ok(())
}

fn same_frames(expected: &Id3v2Tag, actual: &Id3v2Tag) -> bool {
    let mut remaining = actual.iter().collect::<Vec<_>>();
    for frame in expected.iter() {
        let Some(index) = remaining.iter().position(|candidate| *candidate == frame) else {
            return false;
        };
        remaining.remove(index);
    }
    remaining.is_empty()
}
