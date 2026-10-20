use super::{artwork, formats, is_supported_file_type, replaygain};
use crate::metadata::model::{MetadataChange, MetadataField};
use lofty::{
    config::WriteOptions,
    file::{FileType, TaggedFile, TaggedFileExt},
    ogg::{tag::VorbisComments, OggPictureStorage},
    prelude::*,
    tag::{ItemKey, Tag, TagItem, TagType},
};
use std::{fs::File, io::Seek};

pub(super) fn editing_tag(file: &TaggedFile) -> Tag {
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

pub(super) fn writable_fields(file: &TaggedFile, tag: &Tag) -> Vec<MetadataField> {
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
            // Remove alternate storage so an explicit clear cannot resurrect it.
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

pub(super) fn verify_tag_items(expected: &Tag, actual: &Tag) -> Result<(), String> {
    let mut remaining = actual.items().collect::<Vec<_>>();
    let mut dates = Vec::new();
    for item in expected.items().filter(|item| !item.value().is_empty()) {
        // Legacy TORY/TYER can coexist with TDOR/TDRC and map to identical
        // timestamps. ID3 serialization coalesces these aliases into one frame.
        if expected.tag_type() == TagType::Id3v2
            && matches!(
                item.key(),
                ItemKey::OriginalReleaseDate | ItemKey::RecordingDate
            )
        {
            if dates.contains(&item) {
                continue;
            }
            dates.push(item);
        }
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

pub(super) fn save_tag<T: TagExt>(tag: &T, file: &mut File) -> Result<(), String> {
    file.rewind().map_err(|error| error.to_string())?;
    tag.save_to(file, WriteOptions::default())
        .map_err(|error| error.to_string())
}

pub(super) fn save_vorbis_tag(
    mut native: VorbisComments,
    tag: &Tag,
    file: &mut File,
) -> Result<(), String> {
    let editable = |key| {
        key == ItemKey::RecordingDate
            || key == ItemKey::ReleaseDate
            || replaygain::is_replay_gain(key)
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

pub(super) struct Prepared {
    tag: Tag,
    before: Tag,
    secondary: Vec<Tag>,
    write_secondary: bool,
}

impl Prepared {
    pub(super) fn new(
        original: &TaggedFile,
        changes: &[MetadataChange],
        pictures: Option<&[crate::artwork::track::Picture]>,
    ) -> Result<Option<Self>, String> {
        let mut tag = if pictures.is_some() && original.file_type() == FileType::Flac {
            original
                .tag(TagType::VorbisComments)
                .cloned()
                .unwrap_or_else(|| Tag::new(TagType::VorbisComments))
        } else {
            editing_tag(original)
        };
        // A newly selected modern tag must not duplicate fallback pictures.
        if original.tag(tag.tag_type()).is_none() {
            while !tag.pictures().is_empty() {
                tag.remove_picture(0);
            }
        }
        let writable = writable_fields(original, &tag);
        if changes.iter().any(|change| {
            !writable.contains(&change.field) && !MetadataField::IDENTIFIERS.contains(&change.field)
        }) {
            return Err("文件格式或标签不支持所选字段".to_owned());
        }
        validate_totals(&tag, changes)?;
        let before = tag.clone();
        apply_changes(&mut tag, changes)?;
        if let Some(pictures) = pictures {
            let prepared = artwork::prepare_pictures(pictures, tag.tag_type())?;
            while !tag.pictures().is_empty() {
                tag.remove_picture(0);
            }
            for picture in prepared {
                tag.push_picture(picture);
            }
        }
        let same_items = before.items().count() == tag.items().count()
            && before
                .items()
                .all(|item| tag.items().any(|candidate| candidate == item));
        let lyrics_change = changes
            .iter()
            .any(|change| change.field == MetadataField::Lyrics);
        let secondary = original
            .tags()
            .iter()
            .filter(|other| other.tag_type() != tag.tag_type())
            .map(|other| {
                let mut updated = other.clone();
                if pictures.is_some() {
                    while !updated.pictures().is_empty() {
                        updated.remove_picture(0);
                    }
                }
                if lyrics_change {
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
        let secondary_lyrics = lyrics_change
            && original
                .tags()
                .iter()
                .filter(|other| other.tag_type() != tag.tag_type())
                .any(|other| {
                    other.get_strings(ItemKey::Lyrics).next().is_some()
                        || other.get_strings(ItemKey::UnsyncLyrics).next().is_some()
                });
        let secondary_pictures = pictures.is_some()
            && original
                .tags()
                .iter()
                .any(|other| other.tag_type() != tag.tag_type() && !other.pictures().is_empty());
        let secondary_clears = secondary.iter().any(|other| {
            original
                .tag(other.tag_type())
                .is_some_and(|old| old.items().count() != other.items().count())
        });
        let write_secondary = secondary_lyrics || secondary_pictures || secondary_clears;
        if same_items && before.pictures() == tag.pictures() && !write_secondary {
            return Ok(None);
        }
        Ok(Some(Self {
            tag,
            before,
            secondary,
            write_secondary,
        }))
    }

    pub(super) fn write(
        &self,
        destination: &mut File,
        file_type: FileType,
        edit_cover: bool,
    ) -> Result<(), String> {
        formats::write_tag(destination, file_type, &self.tag, edit_cover)
            .map_err(|error| format!("写入标签失败，原文件未修改：{error}"))?;
        if self.write_secondary {
            for other in &self.secondary {
                destination.rewind().map_err(|error| error.to_string())?;
                formats::write_tag(destination, file_type, other, edit_cover)
                    .map_err(|error| format!("清理其他标签失败，原文件未修改：{error}"))?;
            }
        }
        Ok(())
    }

    pub(super) fn verify(
        &self,
        written: &TaggedFile,
        changes: &[MetadataChange],
        pictures: Option<&[crate::artwork::track::Picture]>,
    ) -> Result<(), String> {
        // Empty tags may disappear. Verify the same fallback used by importing.
        let after = editing_tag(written);
        verify_changes(&after, changes)?;
        if pictures.is_none() && self.before.pictures() != after.pictures() {
            return Err("写入影响了内嵌封面，原文件未修改".to_owned());
        }
        if let Some(pictures) = pictures {
            artwork::verify_pictures(written, pictures)?;
        }
        verify_tag_items(&self.tag, &after)?;
        if let Some(change) = changes
            .iter()
            .find(|change| change.field == MetadataField::Lyrics)
        {
            if super::lyrics::embedded_lyrics_text(written) != change.value.as_deref() {
                return Err("歌词回读不一致，原文件未修改".to_owned());
            }
        }
        for other in &self.secondary {
            let empty = Tag::new(other.tag_type());
            let preserved = written.tag(other.tag_type()).unwrap_or(&empty);
            if other.pictures() != preserved.pictures() {
                return Err("写入影响了其他标签格式的图片，原文件未修改".to_owned());
            }
            verify_tag_items(other, preserved)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/verify.rs"]
mod verification;
