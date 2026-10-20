use lofty::{config::WriteOptions, tag::TagType};
use std::{
    fs::File,
    io::{self, Read, Seek},
    path::Path,
};

/// Symphonia 0.5.5's seekable ADTS duration estimate subtracts original_pos twice.
/// This is a current decoder limitation, not an AAC format rule. Separate ID3
/// prefixes only on a disposable copy using Lofty's public removal API.
pub(in crate::metadata::files) fn verify(path: &Path, written: &mut File) -> Result<(), String> {
    let (_temporary, mut payload) = super::super::replacement::TemporaryFile::create(path)?;
    written.rewind().map_err(|error| error.to_string())?;
    io::copy(written, &mut payload).map_err(|error| error.to_string())?;
    let byte_len = payload.metadata().map_err(|error| error.to_string())?.len();
    let mut remaining_len = byte_len;
    loop {
        payload.rewind().map_err(|error| error.to_string())?;
        TagType::Id3v2
            .remove_from(&mut payload, WriteOptions::default().preferred_padding(0))
            .map_err(|error| error.to_string())?;
        let next_len = payload.metadata().map_err(|error| error.to_string())?.len();
        if next_len == remaining_len {
            break;
        }
        remaining_len = next_len;
    }
    payload.rewind().map_err(|error| error.to_string())?;
    let mut sync = [0; 2];
    payload
        .read_exact(&mut sync)
        .map_err(|error| error.to_string())?;
    // The file was parsed as AAC already. Require its frame sync at offset zero
    // after prefix removal, so unknown leading junk cannot invalidate this offset.
    // Twelve sync bits must be one and the ADTS layer bits must be zero.
    if sync[0] != 0xff || sync[1] & 0xf6 != 0xf0 {
        return Err("无法可靠确认 AAC 音频起点，原文件未修改".to_owned());
    }
    let original_pos = byte_len
        .checked_sub(remaining_len)
        .ok_or_else(|| "AAC 标签长度无法验证，原文件未修改".to_owned())?;
    // Keep trailing tags in remaining_len: Symphonia's byte_len includes them too.
    if remaining_len
        .checked_sub(original_pos)
        .is_none_or(|step_bytes| step_bytes < 4)
    {
        return Err(
            "ID3 标签相对 AAC 音频过大，会触发当前播放解码器的时长估算错误；原文件未修改"
                .to_owned(),
        );
    }
    Ok(())
}
