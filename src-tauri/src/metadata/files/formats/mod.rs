pub(super) mod aac;

mod flac;
#[cfg(test)]
#[path = "../tests/aac.rs"]
mod tests;

use super::tags::{save_tag, save_vorbis_tag};
use lofty::{
    config::ParseOptions,
    file::FileType,
    prelude::*,
    tag::{ItemKey, MergeTag, SplitTag, Tag, TagType},
};
use std::fs::File;

pub(super) fn write_tag(
    file: &mut File,
    file_type: FileType,
    tag: &Tag,
    edit_cover: bool,
) -> Result<(), String> {
    // Concrete tags retain native fields that generic Tag cannot represent.
    let options = ParseOptions::default();
    match (file_type, tag.tag_type()) {
        (FileType::Flac, TagType::Id3v2) if edit_cover => flac::write_tag(file, tag),
        (FileType::Flac, TagType::Id3v2) => {
            Err("FLAC 的只读前置 ID3 不能用于字段编辑，原文件未修改".to_owned())
        }
        (FileType::Flac, TagType::VorbisComments) => {
            let native = lofty::flac::FlacFile::read_from(file, options)
                .map_err(|error| error.to_string())?
                .remove_vorbis_comments()
                .unwrap_or_default();
            save_vorbis_tag(native, tag, file)
        }
        (FileType::Vorbis, TagType::VorbisComments) => {
            let native = lofty::ogg::VorbisFile::read_from(file, options)
                .map_err(|error| error.to_string())?
                .remove_vorbis_comments();
            save_vorbis_tag(native, tag, file)
        }
        (FileType::Wav, TagType::RiffInfo) => {
            let native = lofty::iff::wav::WavFile::read_from(file, options)
                .map_err(|error| error.to_string())?
                .remove_riff_info()
                .unwrap_or_default();
            let mut merged = lofty::iff::wav::RiffInfoList::from(tag.clone());
            for (key, value) in native {
                if ItemKey::from_key(TagType::RiffInfo, &key).is_none() {
                    merged.insert(key, value);
                }
            }
            save_tag(&merged, file)
        }
        (FileType::Mpeg, TagType::Ape) => {
            let mut native = lofty::mpeg::MpegFile::read_from(file, options)
                .map_err(|error| error.to_string())?
                .remove_ape()
                .unwrap_or_default();
            if edit_cover {
                for key in lofty::ape::APE_PICTURE_TYPES {
                    native.remove(key);
                }
            }
            let (remainder, _) = native.split_tag();
            save_tag(&remainder.merge_tag(tag.clone()), file)
        }
        // Generic ID3v2 and MP4 tags carry their format-specific companion data.
        _ => save_tag(tag, file),
    }
}
