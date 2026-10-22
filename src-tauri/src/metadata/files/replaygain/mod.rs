use super::{formats, read_file, replacement, tags::verify_tag_items};
use lofty::{
    config::ParseOptions,
    file::{FileType, TaggedFile, TaggedFileExt},
    probe::Probe,
    tag::{ItemKey, Tag, TagExt, TagType},
};
use std::{fs, io::Seek, path::Path};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct TrackGain {
    pub gain_db: Option<f64>,
    pub peak: Option<f64>,
}

impl TrackGain {
    pub(crate) fn complete(self) -> bool {
        self.gain_db.is_some() && self.peak.is_some()
    }
}

fn number(value: &str) -> Option<f64> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

fn gain(value: &str) -> Option<f64> {
    let value = value.trim();
    let number_part = value
        .get(value.len().saturating_sub(2)..)
        .filter(|suffix| suffix.eq_ignore_ascii_case("db"))
        .map(|_| &value[..value.len() - 2])
        .unwrap_or(value);
    number(number_part).filter(|value| (-120.0..=60.0).contains(value))
}

fn from_tag(tag: &Tag) -> TrackGain {
    TrackGain {
        gain_db: tag.get_strings(ItemKey::ReplayGainTrackGain).find_map(gain),
        peak: tag
            .get_strings(ItemKey::ReplayGainTrackPeak)
            .filter_map(number)
            .find(|peak| *peak >= 0.0),
    }
}

fn preferred_type(file: &TaggedFile) -> TagType {
    match file.file_type() {
        FileType::Wav | FileType::Mpeg | FileType::Aac => TagType::Id3v2,
        FileType::Flac | FileType::Vorbis => TagType::VorbisComments,
        _ => file.primary_tag_type(),
    }
}

fn selected_tag(file: &TaggedFile) -> Option<&Tag> {
    let preferred = file.tag(preferred_type(file));
    preferred
        .into_iter()
        .chain(
            file.tags()
                .iter()
                .filter(|tag| Some(tag.tag_type()) != preferred.map(Tag::tag_type)),
        )
        .find(|tag| {
            let value = from_tag(tag);
            value.gain_db.is_some() || value.peak.is_some()
        })
}

fn from_file(file: &TaggedFile) -> TrackGain {
    selected_tag(file).map(from_tag).unwrap_or_default()
}

pub(crate) fn read(path: &Path) -> Result<TrackGain, String> {
    let file = Probe::open(path)
        .map_err(|error| error.to_string())?
        .guess_file_type()
        .map_err(|error| error.to_string())?
        .options(
            ParseOptions::default()
                .read_properties(false)
                .read_cover_art(false),
        )
        .read()
        .map_err(|error| error.to_string())?;
    Ok(from_file(&file))
}

pub(crate) fn write(path: &Path, measured: TrackGain, overwrite: bool) -> Result<bool, String> {
    if !measured
        .gain_db
        .is_some_and(|value| value.is_finite() && (-120.0..=60.0).contains(&value))
        || !measured
            .peak
            .is_some_and(|value| value.is_finite() && value >= 0.0)
    {
        return Err("响度分析结果无效或不完整".to_owned());
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let original = read_file(path)?;
    let existing = from_file(&original);
    if !overwrite && existing.complete() {
        return Ok(false);
    }
    if metadata.permissions().readonly() {
        return Err("文件为只读".to_owned());
    }
    if !super::is_supported_file_type(original.file_type()) {
        return Err("此文件格式不支持 ReplayGain 标签写入".to_owned());
    }
    let target_type = preferred_type(&original);
    let mut target = original
        .tag(target_type)
        .cloned()
        .unwrap_or_else(|| Tag::new(target_type));
    let preserved = (!overwrite).then(|| selected_tag(&original)).flatten();
    let gain_text = preserved
        .and_then(|tag| {
            tag.get_strings(ItemKey::ReplayGainTrackGain)
                .find(|text| gain(text).is_some())
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{:+.2} dB", measured.gain_db.unwrap()));
    let peak_text = preserved
        .and_then(|tag| {
            tag.get_strings(ItemKey::ReplayGainTrackPeak)
                .find(|text| number(text).is_some_and(|value| value >= 0.0))
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{:.8}", measured.peak.unwrap()));
    target.insert_text(ItemKey::ReplayGainTrackGain, gain_text.clone());
    target.insert_text(ItemKey::ReplayGainTrackPeak, peak_text.clone());
    let mut tags = vec![target];
    for tag in original
        .tags()
        .iter()
        .filter(|tag| tag.tag_type() != target_type)
    {
        let mut tag = tag.clone();
        // Do not leave conflicting values behind in secondary tag formats.
        if ItemKey::ReplayGainTrackGain
            .map_key(tag.tag_type())
            .is_some()
            && !(original.file_type() == FileType::Flac && tag.tag_type() == TagType::Id3v2)
        {
            if overwrite || from_tag(&tag).gain_db.is_none() {
                tag.insert_text(ItemKey::ReplayGainTrackGain, gain_text.clone());
            }
            if overwrite || from_tag(&tag).peak.is_none() {
                tag.insert_text(ItemKey::ReplayGainTrackPeak, peak_text.clone());
            }
        }
        tags.push(tag);
    }
    save(path, &metadata, &original, &tags)?;
    Ok(true)
}

pub(super) fn is_replay_gain(key: ItemKey) -> bool {
    matches!(
        key,
        ItemKey::ReplayGainTrackGain
            | ItemKey::ReplayGainTrackPeak
            | ItemKey::ReplayGainAlbumGain
            | ItemKey::ReplayGainAlbumPeak
    )
}

pub(crate) fn remove(path: &Path) -> Result<bool, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let original = read_file(path)?;
    if !original
        .tags()
        .iter()
        .any(|tag| tag.items().any(|item| is_replay_gain(item.key())))
    {
        return Ok(false);
    }
    if metadata.permissions().readonly() {
        return Err("文件为只读".to_owned());
    }
    if !super::is_supported_file_type(original.file_type()) {
        return Err("此文件格式不支持 ReplayGain 标签写入".to_owned());
    }
    let tags: Vec<_> = original
        .tags()
        .iter()
        .cloned()
        .map(|mut tag| {
            tag.retain(|item| !is_replay_gain(item.key()));
            tag
        })
        .collect();
    save(path, &metadata, &original, &tags)?;
    Ok(true)
}

fn save(
    path: &Path,
    metadata: &fs::Metadata,
    original: &TaggedFile,
    tags: &[Tag],
) -> Result<(), String> {
    replacement::replace(
        path,
        metadata,
        |copy, destination| {
            for tag in tags {
                if original.tag(tag.tag_type()).is_some_and(|old| {
                    old.items().count() == tag.items().count()
                        && old
                            .items()
                            .all(|item| tag.items().any(|candidate| candidate == item))
                }) {
                    continue;
                }
                destination.rewind().map_err(|error| error.to_string())?;
                formats::write_tag(destination, original.file_type(), tag, false)
                    .map_err(|error| format!("写入 ReplayGain 失败，原文件未修改：{error}"))?;
            }
            if original.file_type() == FileType::Aac {
                formats::aac::verify(copy, destination)?;
            }
            Ok(())
        },
        |copy| {
            let confirmed = read_file(copy)?;
            for expected in tags {
                let empty = Tag::new(expected.tag_type());
                let actual = confirmed.tag(expected.tag_type()).unwrap_or(&empty);
                verify_tag_items(expected, actual)?;
                if original.tag(expected.tag_type()).is_some_and(|old| {
                    old.items()
                        .any(|item| !expected.contains(item.key()) && actual.contains(item.key()))
                }) {
                    return Err("ReplayGain 标签移除后回读不一致，原文件未修改".to_owned());
                }
                if expected.pictures() != actual.pictures() {
                    return Err("写入影响了内嵌封面，原文件未修改".to_owned());
                }
            }
            Ok(())
        },
    )
}
