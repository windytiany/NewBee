use lofty::tag::{ItemKey, TagType};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MetadataField {
    Title,
    Artist,
    Album,
    AlbumArtist,
    ReleaseDate,
    TrackNumber,
    DiscNumber,
    TrackTotal,
    DiscTotal,
    Lyrics,
}

impl MetadataField {
    pub(crate) const ALL: [Self; 10] = [
        Self::Title,
        Self::Artist,
        Self::Album,
        Self::AlbumArtist,
        Self::ReleaseDate,
        Self::TrackNumber,
        Self::DiscNumber,
        Self::TrackTotal,
        Self::DiscTotal,
        Self::Lyrics,
    ];

    pub(crate) fn column(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::Artist => "artist",
            Self::Album => "album",
            Self::AlbumArtist => "album_artist",
            Self::ReleaseDate => "release_date",
            Self::TrackNumber => "track_number",
            Self::DiscNumber => "disc_number",
            Self::TrackTotal => "track_total",
            Self::DiscTotal => "disc_total",
            Self::Lyrics => "lyrics",
        }
    }

    pub(crate) fn key(self, tag_type: TagType) -> ItemKey {
        match self {
            Self::Title => ItemKey::TrackTitle,
            Self::Artist => ItemKey::TrackArtist,
            Self::Album => ItemKey::AlbumTitle,
            Self::AlbumArtist => ItemKey::AlbumArtist,
            Self::ReleaseDate if ItemKey::ReleaseDate.map_key(tag_type).is_none() => {
                ItemKey::RecordingDate
            }
            Self::ReleaseDate => ItemKey::ReleaseDate,
            Self::TrackNumber => ItemKey::TrackNumber,
            Self::DiscNumber => ItemKey::DiscNumber,
            Self::TrackTotal => ItemKey::TrackTotal,
            Self::DiscTotal => ItemKey::DiscTotal,
            Self::Lyrics if tag_type == TagType::Id3v2 => ItemKey::UnsyncLyrics,
            Self::Lyrics => ItemKey::Lyrics,
        }
    }

    pub(crate) fn is_number(self) -> bool {
        matches!(
            self,
            Self::TrackNumber | Self::DiscNumber | Self::TrackTotal | Self::DiscTotal
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MetadataChange {
    pub(crate) field: MetadataField,
    pub(crate) value: Option<String>,
}

pub(crate) fn normalize_changes(changes: &mut [MetadataChange]) -> Result<(), String> {
    if changes.is_empty() {
        return Err("请选择至少一个写入字段".to_owned());
    }
    let mut fields = HashSet::new();
    for change in changes {
        if !fields.insert(change.field) {
            return Err("写入字段不能重复".to_owned());
        }
        change.value = change.value.take().and_then(|value| {
            if change.field == MetadataField::Lyrics {
                (!value.is_empty()).then_some(value)
            } else {
                let value = value.trim();
                (!value.is_empty()).then(|| value.to_owned())
            }
        });
        let Some(value) = change.value.as_mut() else {
            continue;
        };
        if value.contains('\0') {
            return Err("标签不能包含空字符".to_owned());
        }
        if change.field.is_number() {
            if !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err("编号和总数必须是正整数或留空".to_owned());
            }
            let number = value
                .parse::<u32>()
                .ok()
                .filter(|number| *number > 0)
                .ok_or_else(|| "编号和总数必须是有效的正整数".to_owned())?;
            *value = number.to_string();
        } else if change.field == MetadataField::ReleaseDate && !valid_date(value) {
            return Err("发行日期必须是有效的 YYYY、YYYY-MM 或 YYYY-MM-DD".to_owned());
        }
    }
    Ok(())
}

fn valid_date(value: &str) -> bool {
    if !matches!(value.len(), 4 | 7 | 10) {
        return false;
    }
    let parts: Vec<_> = value.split('-').collect();
    if parts
        .iter()
        .any(|part| !part.bytes().all(|byte| byte.is_ascii_digit()))
        || parts[0].len() != 4
        || parts.iter().skip(1).any(|part| part.len() != 2)
    {
        return false;
    }
    let year = parts[0].parse::<u32>().unwrap_or(0);
    if year == 0 {
        return false;
    }
    if parts.len() == 1 {
        return true;
    }
    let month = parts[1].parse::<u32>().unwrap_or(0);
    if !(1..=12).contains(&month) {
        return false;
    }
    if parts.len() == 2 {
        return true;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    let day = parts[2].parse::<u32>().unwrap_or(0);
    (1..=days).contains(&day)
}

pub(crate) fn validate_track_ids(track_ids: &[i64]) -> Result<Vec<i64>, String> {
    if track_ids.is_empty() || track_ids.iter().any(|id| *id <= 0) {
        return Err("请选择有效的曲目".to_owned());
    }
    let mut seen = HashSet::new();
    Ok(track_ids
        .iter()
        .copied()
        .filter(|id| seen.insert(*id))
        .collect())
}
