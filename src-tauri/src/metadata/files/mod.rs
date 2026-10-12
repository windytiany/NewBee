mod aac;
mod flac;
pub(crate) mod lyrics;
mod model;
mod snapshot;
pub(crate) use model::FileTrack;
pub(crate) mod commands;
use super::model::{EditingSnapshot, MetadataChange, MetadataField};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::ogg::{tag::VorbisComments, OggPictureStorage};
use lofty::picture::{Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, MergeTag, SplitTag, Tag, TagItem, TagType};
pub(crate) use snapshot::read_track;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Seek};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) const MAX_COVER_BYTES: usize = 20 * 1024 * 1024;
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

fn read_file(path: &Path) -> Result<TaggedFile, String> {
    #[cfg(test)]
    access::record(path, "parse");
    Probe::open(path)
        .map_err(|error| format!("读取文件标签失败：{error}"))?
        .guess_file_type()
        .map_err(|error| format!("识别文件格式失败：{error}"))?
        .read()
        .map_err(|error| format!("读取文件标签失败：{error}"))
}

fn editing_tag(file: &TaggedFile) -> Tag {
    if matches!(
        file.file_type(),
        FileType::Wav | FileType::Mpeg | FileType::Aac
    ) && file.tag(TagType::Id3v2).is_none()
    {
        let mut tag = file
            .first_tag()
            .cloned()
            .unwrap_or_else(|| Tag::new(TagType::Id3v2));
        tag.re_map(TagType::Id3v2);
        return tag;
    }
    file.primary_tag()
        .or_else(|| file.first_tag())
        .cloned()
        .unwrap_or_else(|| Tag::new(file.primary_tag_type()))
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

fn writable_fields(file: &TaggedFile, tag: &Tag) -> Vec<MetadataField> {
    if !is_supported_file_type(file.file_type()) {
        return Vec::new();
    }
    MetadataField::ALL
        .into_iter()
        .filter(|field| {
            // ID3v1 dates are restricted to a year, so do not expose a full-date editor.
            (*field != MetadataField::ReleaseDate || tag.tag_type() != TagType::Id3v1)
                && Tag::new(tag.tag_type()).insert_text(field.key(tag.tag_type()), "1".to_owned())
        })
        .collect()
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

fn apply_changes(tag: &mut Tag, changes: &[MetadataChange]) -> Result<(), String> {
    for change in changes {
        let key = change.field.key(tag.tag_type());
        if MetadataField::IDENTIFIERS.contains(&change.field) {
            if change.values.is_empty() {
                continue;
            }
            tag.remove_key(key);
            for value in &change.values {
                if !tag.push(TagItem::new(
                    key,
                    lofty::tag::ItemValue::Text(value.clone()),
                )) {
                    return Err(format!("标签不支持标识 {:?}", change.field));
                }
            }
            continue;
        }
        if change.field == MetadataField::ReleaseDate {
            // Remove the alternate release-date storage so an explicit clear cannot resurrect it.
            tag.remove_key(ItemKey::ReleaseDate);
            tag.remove_key(ItemKey::RecordingDate);
        } else if change.field == MetadataField::Lyrics {
            tag.remove_key(ItemKey::Lyrics);
            tag.remove_key(ItemKey::UnsyncLyrics);
        } else {
            tag.remove_key(key);
        }
        if let Some(value) = &change.value {
            if !tag.insert_text(key, value.clone()) {
                return Err(format!("标签不支持字段 {:?}", change.field));
            }
        }
    }
    Ok(())
}

fn verify_changes(tag: &Tag, changes: &[MetadataChange]) -> Result<(), String> {
    for change in changes {
        if MetadataField::IDENTIFIERS.contains(&change.field) {
            if !change.values.is_empty()
                && tag
                    .get_strings(change.field.key(tag.tag_type()))
                    .collect::<Vec<_>>()
                    != change.values.iter().map(String::as_str).collect::<Vec<_>>()
            {
                return Err(format!("标识 {:?} 回读不一致，原文件未修改", change.field));
            }
            continue;
        }
        let actual = tag
            .get_string(change.field.key(tag.tag_type()))
            .filter(|value| !value.is_empty());
        let matches = match change.value.as_deref() {
            None => actual.is_none(),
            Some(expected) if change.field.is_number() => {
                let actual = actual.and_then(|value| value.split('/').next()?.parse::<u32>().ok());
                matches!((actual, expected.parse::<u32>().ok()), (Some(a), Some(b)) if a == b)
            }
            Some(expected) => actual == Some(expected),
        };
        if !matches {
            return Err(format!(
                "字段 {:?} 写入后回读不一致，原文件未修改",
                change.field
            ));
        }
    }
    Ok(())
}

fn validate_totals(tag: &Tag, changes: &[MetadataChange]) -> Result<(), String> {
    let mut updated = tag.clone();
    apply_changes(&mut updated, changes)?;
    for (number_field, total_field, number, total) in [
        (
            MetadataField::TrackNumber,
            MetadataField::TrackTotal,
            updated.track(),
            updated.track_total(),
        ),
        (
            MetadataField::DiscNumber,
            MetadataField::DiscTotal,
            updated.disk(),
            updated.disk_total(),
        ),
    ] {
        if !changes
            .iter()
            .any(|change| change.field == number_field || change.field == total_field)
        {
            continue;
        }
        if matches!((number, total), (Some(number), Some(total)) if total > 0 && number > total) {
            return Err("编号不能大于对应总数".to_owned());
        }
    }
    Ok(())
}

fn same_item(expected: &TagItem, actual: &TagItem) -> bool {
    if expected == actual {
        return true;
    }
    if expected.key() != actual.key()
        || expected.lang() != actual.lang()
        || expected.description() != actual.description()
        || !matches!(
            expected.key(),
            ItemKey::TrackNumber | ItemKey::TrackTotal | ItemKey::DiscNumber | ItemKey::DiscTotal
        )
    {
        return false;
    }
    // Number formatting is not metadata: 02 and 2 represent the same track number.
    let number = |item: &TagItem| item.value().text()?.parse::<u32>().ok();
    matches!((number(expected), number(actual)), (Some(a), Some(b)) if a == b)
}

fn verify_tag_items(expected: &Tag, actual: &Tag) -> Result<(), String> {
    let mut remaining = actual.items().collect::<Vec<_>>();
    for item in expected.items().filter(|item| !item.value().is_empty()) {
        let Some(index) = remaining
            .iter()
            .position(|candidate| same_item(item, candidate))
        else {
            return Err(format!(
                "标签 {:?} 的字段 {:?} 写入后回读不一致，原文件未修改",
                expected.tag_type(),
                item.key()
            ));
        };
        // Match occurrences, not just membership, so repeated nonempty values are preserved.
        remaining.remove(index);
    }
    Ok(())
}

fn save_tag<T: TagExt>(tag: &T, file: &mut File) -> Result<(), String> {
    file.rewind().map_err(|error| error.to_string())?;
    tag.save_to(file, WriteOptions::default())
        .map_err(|error| error.to_string())
}

fn save_vorbis_tag(mut native: VorbisComments, tag: &Tag, file: &mut File) -> Result<(), String> {
    let editable = |key| {
        key == ItemKey::RecordingDate
            || key == ItemKey::ReleaseDate
            || MetadataField::ALL
                .iter()
                .chain(MetadataField::IDENTIFIERS.iter())
                .any(|field| field.key(TagType::VorbisComments) == key)
    };
    // Replace editor fields only. Keep vendor, encoder, custom comments and all
    // other native fields outside the generic conversion path.
    for (key, value) in native.take_items() {
        if !ItemKey::from_key(TagType::VorbisComments, &key).is_some_and(editable) {
            native.push(key, value);
        }
    }
    for item in tag.items().filter(|item| editable(item.key())) {
        if let (Some(key), Some(value)) = (
            item.key().map_key(TagType::VorbisComments),
            item.value().text(),
        ) {
            native.push(key.to_owned(), value.to_owned());
        }
    }
    while !native.pictures().is_empty() {
        native.remove_picture(0);
    }
    for picture in tag.pictures() {
        native
            .insert_picture(picture.clone(), None)
            .map_err(|error| error.to_string())?;
    }
    save_tag(&native, file)
}

fn write_tag(
    file: &mut File,
    file_type: FileType,
    tag: &Tag,
    edit_cover: bool,
) -> Result<(), String> {
    // Use concrete tags for formats whose unmapped fields are not retained by
    // generic Tag. No raw metadata block parsing or rewriting is needed.
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
            let native = lofty::mpeg::MpegFile::read_from(file, options)
                .map_err(|error| error.to_string())?
                .remove_ape()
                .unwrap_or_default();
            let (remainder, _) = native.split_tag();
            save_tag(&remainder.merge_tag(tag.clone()), file)
        }
        // Generic ID3v2 and MP4 tags carry their format-specific companion data.
        _ => save_tag(tag, file),
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
    let metadata = file_metadata(path).map_err(|error| error.to_string())?;
    if metadata.permissions().readonly() {
        return Err("文件为只读".to_owned());
    }
    let original = read_file(path)?;
    if !is_supported_file_type(original.file_type()) {
        return Err("此文件格式不支持标签写入".to_owned());
    }
    let mut tag = editing_tag(&original);
    // A newly selected modern tag must not duplicate pictures from a fallback tag.
    // The original tag's pictures remain untouched unless the cover is edited.
    if original.tag(tag.tag_type()).is_none() {
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
    }
    let writable = writable_fields(&original, &tag);
    if changes.iter().any(|change| {
        !writable.contains(&change.field) && !MetadataField::IDENTIFIERS.contains(&change.field)
    }) {
        return Err("文件格式或标签不支持所选字段".to_owned());
    }
    validate_totals(&tag, changes)?;
    let before = tag.clone();
    apply_changes(&mut tag, changes)?;
    if let Some(ref cover) = cover {
        if !matches!(
            tag.tag_type(),
            TagType::Id3v2 | TagType::Mp4Ilst | TagType::VorbisComments
        ) {
            return Err("此标签格式不支持内嵌封面".to_owned());
        }
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
        if let CoverAction::Replace(picture) = cover {
            let mut picture = (*picture).clone();
            if tag.tag_type() == TagType::Mp4Ilst {
                picture.set_pic_type(PictureType::Other);
            }
            tag.push_picture(picture);
        }
    }
    let same_items = before.items().count() == tag.items().count()
        && before
            .items()
            .all(|item| tag.items().any(|candidate| candidate == item));
    let lyrics_change = changes
        .iter()
        .find(|change| change.field == MetadataField::Lyrics);
    let secondary_tags = original
        .tags()
        .iter()
        .filter(|other| other.tag_type() != tag.tag_type())
        .map(|other| {
            let mut updated = other.clone();
            if cover.is_some() {
                while !updated.pictures().is_empty() {
                    updated.remove_picture(0);
                }
            }
            if lyrics_change.is_some() {
                updated.remove_key(ItemKey::Lyrics);
                updated.remove_key(ItemKey::UnsyncLyrics);
            }
            // Explicit clears must not reappear through a secondary-tag fallback.
            for change in changes.iter().filter(|change| {
                change.value.is_none() && !MetadataField::IDENTIFIERS.contains(&change.field)
            }) {
                updated.remove_key(change.field.key(updated.tag_type()));
                if change.field == MetadataField::ReleaseDate {
                    updated.remove_key(ItemKey::ReleaseDate);
                    updated.remove_key(ItemKey::RecordingDate);
                    updated.remove_key(ItemKey::Year);
                }
            }
            updated
        })
        .collect::<Vec<_>>();
    let secondary_lyrics = lyrics_change.is_some()
        && original
            .tags()
            .iter()
            .filter(|other| other.tag_type() != tag.tag_type())
            .any(|other| {
                other.get_strings(ItemKey::Lyrics).next().is_some()
                    || other.get_strings(ItemKey::UnsyncLyrics).next().is_some()
            });
    let secondary_pictures = cover.is_some()
        && original
            .tags()
            .iter()
            .any(|other| other.tag_type() != tag.tag_type() && !other.pictures().is_empty());
    let secondary_clears = secondary_tags.iter().any(|other| {
        original
            .tag(other.tag_type())
            .is_some_and(|old| old.items().count() != other.items().count())
    });
    if same_items
        && before.pictures() == tag.pictures()
        && !secondary_lyrics
        && !secondary_pictures
        && !secondary_clears
    {
        return Ok(());
    }

    let (temporary, mut destination) = TemporaryFile::create(path)?;
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    io::copy(&mut source, &mut destination)
        .map_err(|error| format!("创建安全副本失败：{error}"))?;
    drop(source);
    destination.rewind().map_err(|error| error.to_string())?;
    write_tag(
        &mut destination,
        original.file_type(),
        &tag,
        cover.is_some(),
    )
    .map_err(|error| format!("写入标签失败，原文件未修改：{error}"))?;
    if secondary_lyrics || secondary_pictures || secondary_clears {
        for other in &secondary_tags {
            destination.rewind().map_err(|error| error.to_string())?;
            write_tag(
                &mut destination,
                original.file_type(),
                other,
                cover.is_some(),
            )
            .map_err(|error| format!("清理其他标签失败，原文件未修改：{error}"))?;
        }
    }
    if original.file_type() == FileType::Aac {
        aac::verify(&temporary.0, &mut destination)?;
    }
    destination.sync_all().map_err(|error| error.to_string())?;
    drop(destination);

    let written = read_file(&temporary.0)?;
    // Writers may remove a completely empty tag. Check the same primary/fallback tag that
    // importing would read, so secondary old values cannot silently resurrect cleared fields.
    let after = editing_tag(&written);
    verify_changes(&after, changes)?;
    if cover.is_none() && before.pictures() != after.pictures() {
        return Err("写入影响了内嵌封面，原文件未修改".to_owned());
    }
    if cover.is_some() && tag.pictures() != after.pictures() {
        return Err("封面回读不一致或其他图片发生变化，原文件未修改".to_owned());
    }
    // Verify the requested final tag, allowing empty items to disappear and numbers
    // to lose leading zeroes. Nonempty generic values must survive.
    verify_tag_items(&tag, &after)?;
    if let Some(change) = lyrics_change {
        let actual = crate::metadata::files::lyrics::embedded_lyrics_text(&written);
        if actual != change.value.as_deref() {
            return Err("歌词回读不一致，原文件未修改".to_owned());
        }
    }
    for other in &secondary_tags {
        let empty = Tag::new(other.tag_type());
        let preserved = written.tag(other.tag_type()).unwrap_or(&empty);
        if other.pictures() != preserved.pictures() {
            return Err("写入影响了其他标签格式的图片，原文件未修改".to_owned());
        }
        verify_tag_items(other, preserved)?;
    }
    fs::set_permissions(&temporary.0, metadata.permissions()).map_err(|error| error.to_string())?;
    fs::rename(&temporary.0, path)
        .map_err(|error| format!("替换文件失败，原文件未修改：{error}"))?;
    Ok(())
}

struct TemporaryFile(PathBuf);

impl TemporaryFile {
    fn create(path: &Path) -> Result<(Self, File), String> {
        let parent = path.parent().ok_or_else(|| "文件没有父目录".to_owned())?;
        loop {
            let temporary = parent.join(format!(
                ".newbee-metadata-{}-{}.tmp",
                std::process::id(),
                NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed)
            ));
            match OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&temporary)
            {
                Ok(file) => return Ok((Self(temporary), file)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("无法创建安全副本：{error}")),
            }
        }
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.0) {
            if error.kind() != io::ErrorKind::NotFound {
                log::warn!(
                    "Could not clean metadata temporary file '{}': {error}",
                    self.0.display()
                );
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/aac.rs"]
mod aac_tests;

#[cfg(test)]
#[path = "tests/verify.rs"]
mod verification;

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
