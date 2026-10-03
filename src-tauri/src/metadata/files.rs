use super::model::{MetadataChange, MetadataField};
use lofty::config::WriteOptions;
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag, TagType};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Seek};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

fn read_file(path: &Path) -> Result<TaggedFile, String> {
    Probe::open(path)
        .map_err(|error| format!("读取文件标签失败：{error}"))?
        .guess_file_type()
        .map_err(|error| format!("识别文件格式失败：{error}"))?
        .read()
        .map_err(|error| format!("读取文件标签失败：{error}"))
}

fn editing_tag(file: &TaggedFile) -> Tag {
    file.primary_tag()
        .or_else(|| file.first_tag())
        .cloned()
        .unwrap_or_else(|| Tag::new(file.primary_tag_type()))
}

fn writable_fields(file: &TaggedFile, tag: &Tag) -> Vec<MetadataField> {
    if !matches!(
        file.file_type(),
        FileType::Mpeg
            | FileType::Aac
            | FileType::Mp4
            | FileType::Vorbis
            | FileType::Flac
            | FileType::Wav
    ) {
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

pub(super) struct FileMetadata {
    pub(super) writable_fields: Vec<MetadataField>,
    pub(super) lyrics: Option<String>,
    pub(super) issue: Option<String>,
}

pub(super) fn inspect_file(path: &Path) -> Result<FileMetadata, String> {
    let readonly = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions()
        .readonly();
    let file = read_file(path)?;
    let tag = editing_tag(&file);
    let lyrics = tag.get_string(&ItemKey::Lyrics).map(str::to_owned);
    let writable_fields = if readonly {
        Vec::new()
    } else {
        writable_fields(&file, &tag)
    };
    let issue = if readonly {
        Some("文件为只读".to_owned())
    } else if writable_fields.is_empty() {
        Some("此文件格式不支持标签写入".to_owned())
    } else {
        None
    };
    Ok(FileMetadata {
        writable_fields,
        lyrics,
        issue,
    })
}

fn apply_changes(tag: &mut Tag, changes: &[MetadataChange]) -> Result<(), String> {
    for change in changes {
        let key = change.field.key(tag.tag_type());
        if change.field == MetadataField::ReleaseDate {
            // Import falls back to RecordingDate. Clearing a date must clear that fallback too.
            tag.remove_key(&ItemKey::ReleaseDate);
            tag.remove_key(&ItemKey::RecordingDate);
        } else {
            tag.remove_key(&key);
        }
        if let Some(value) = &change.value {
            if !tag.insert_text(key, value.clone()) {
                return Err(format!("标签不支持字段 {}", change.field.column()));
            }
        }
    }
    Ok(())
}

fn verify_changes(tag: &Tag, changes: &[MetadataChange]) -> Result<(), String> {
    for change in changes {
        let actual = tag.get_string(&change.field.key(tag.tag_type()));
        let matches = if change.field.is_number() {
            let actual = actual.and_then(|value| value.split('/').next()?.parse::<u32>().ok());
            let expected = change
                .value
                .as_deref()
                .and_then(|value| value.parse::<u32>().ok());
            actual == expected
        } else {
            actual.filter(|value| !value.is_empty()) == change.value.as_deref()
        };
        if !matches {
            return Err(format!(
                "字段 {} 写入后回读不一致，原文件未修改",
                change.field.column()
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

pub(super) fn validate_file(path: &Path, changes: &[MetadataChange]) -> Result<(), String> {
    let file = read_file(path)?;
    let tag = editing_tag(&file);
    validate_totals(&tag, changes)
}

/// Only the selected tag is written. A failed write or round-trip check never touches the original.
pub(super) fn write_file(path: &Path, changes: &[MetadataChange]) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.permissions().readonly() {
        return Err("文件为只读".to_owned());
    }
    let original = read_file(path)?;
    let mut tag = editing_tag(&original);
    let writable = writable_fields(&original, &tag);
    if changes
        .iter()
        .any(|change| !writable.contains(&change.field))
    {
        return Err("文件格式或标签不支持所选字段".to_owned());
    }
    validate_totals(&tag, changes)?;
    let before = tag.clone();
    apply_changes(&mut tag, changes)?;

    let (temporary, mut destination) = TemporaryFile::create(path)?;
    let mut source = File::open(path).map_err(|error| error.to_string())?;
    io::copy(&mut source, &mut destination)
        .map_err(|error| format!("创建安全副本失败：{error}"))?;
    drop(source);
    destination.rewind().map_err(|error| error.to_string())?;
    tag.save_to(&mut destination, WriteOptions::default())
        .map_err(|error| format!("写入标签失败，原文件未修改：{error}"))?;
    destination.sync_all().map_err(|error| error.to_string())?;
    drop(destination);

    let written = read_file(&temporary.0)?;
    // Writers may remove a completely empty tag. Check the same primary/fallback tag that
    // importing would read, so secondary old values cannot silently resurrect cleared fields.
    let after = editing_tag(&written);
    verify_changes(&after, changes)?;
    if before.pictures() != after.pictures() {
        return Err("写入影响了内嵌封面，原文件未修改".to_owned());
    }
    // Generic tag conversion retains format-specific companion data. Also verify all visible
    // untouched items, rather than silently dropping custom fields or totals.
    for item in before.items().filter(|item| {
        !changes.iter().any(|change| {
            item.key() == &change.field.key(before.tag_type())
                || (change.field == MetadataField::ReleaseDate
                    && item.key() == &ItemKey::RecordingDate)
        })
    }) {
        if !after.items().any(|candidate| candidate == item) {
            return Err("写入影响了未编辑的标签，原文件未修改".to_owned());
        }
    }
    for other in original
        .tags()
        .iter()
        .filter(|other| other.tag_type() != tag.tag_type())
    {
        let preserved = written
            .tag(other.tag_type())
            .ok_or_else(|| "其他标签格式丢失".to_owned())?;
        if other.pictures() != preserved.pictures()
            || other.items().collect::<Vec<_>>() != preserved.items().collect::<Vec<_>>()
        {
            return Err("写入影响了其他标签格式，原文件未修改".to_owned());
        }
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
                eprintln!(
                    "Could not clean metadata temporary file '{}': {error}",
                    self.0.display()
                );
            }
        }
    }
}
