use crate::tracks::model::TrackWriteInput;
use lofty::{
    file::FileType,
    prelude::*,
    tag::{ItemKey, Tag},
};
use std::path::Path;

#[derive(Clone, Copy)]
enum Mode {
    Metadata,
    Collection,
}

pub(crate) struct ArtworkSnapshot {
    pub track: TrackWriteInput,
    pub embedded: Result<Vec<crate::artwork::track::Picture>, String>,
}

pub(crate) fn read_track(path: &Path) -> Result<Option<TrackWriteInput>, String> {
    read_snapshot(path, Mode::Metadata).map(|snapshot| snapshot.map(|snapshot| snapshot.track))
}

pub(crate) fn read_track_metadata(path: &Path) -> Result<Option<TrackWriteInput>, String> {
    read_snapshot(path, Mode::Metadata).map(|snapshot| snapshot.map(|snapshot| snapshot.track))
}

pub(crate) fn read_track_collection(path: &Path) -> Result<Option<ArtworkSnapshot>, String> {
    read_snapshot(path, Mode::Collection)
}

fn read_snapshot(path: &Path, mode: Mode) -> Result<Option<ArtworkSnapshot>, String> {
    let include_artwork = !matches!(mode, Mode::Metadata);
    let tagged_file = super::read_file_with_options(
        path,
        lofty::config::ParseOptions::default().read_cover_art(include_artwork),
    )?;
    let readonly = super::file_metadata(path)
        .map_err(|error| error.to_string())?
        .permissions()
        .readonly();
    let editing = super::metadata_from_file(&tagged_file, readonly);
    let file_type = tagged_file.file_type();
    if !super::is_supported_file_type(file_type) {
        return Ok(None);
    }

    let properties = tagged_file.properties();
    let editing_tag = super::editing_tag(&tagged_file);
    let tag = Some(&editing_tag);
    let (title, artist, album, album_artist, release_date, disc_number, track_number) = match tag {
        Some(tag) => (
            tag_text(tag, &ItemKey::TrackTitle),
            tag_text(tag, &ItemKey::TrackArtist),
            tag_text(tag, &ItemKey::AlbumTitle),
            tag_text(tag, &ItemKey::AlbumArtist),
            tag_text(tag, &ItemKey::RecordingDate).or_else(|| tag_text(tag, &ItemKey::ReleaseDate)),
            tag_number(tag, &ItemKey::DiscNumber),
            tag_number(tag, &ItemKey::TrackNumber),
        ),
        None => (None, None, None, None, None, None, None),
    };

    let duration_ms = i64::try_from(properties.duration().as_millis())
        .ok()
        .filter(|duration| *duration > 0);

    Ok(Some(ArtworkSnapshot {
        embedded: if matches!(mode, Mode::Collection) {
            super::artwork::pictures_from_file(&tagged_file)
        } else {
            Ok(Vec::new())
        },
        track: TrackWriteInput {
            path: path.to_string_lossy().into_owned(),
            title,
            artist,
            album,
            album_artist,
            release_date,
            disc_number,
            track_number,
            disc_total: tag.and_then(|tag| tag.disk_total()).map(i64::from),
            track_total: tag.and_then(|tag| tag.track_total()).map(i64::from),
            duration_ms,
            codec: codec_for_file_type(file_type).map(str::to_owned),
            sample_rate_hz: properties.sample_rate().map(i64::from),
            bitrate_kbps: properties.audio_bitrate().map(i64::from),
            channels: properties.channels().map(i64::from),
            editing: Some(editing),
            lyrics: crate::metadata::files::lyrics::embedded_lyrics_text(&tagged_file)
                .map(str::to_owned),
        },
    }))
}

fn codec_for_file_type(file_type: FileType) -> Option<&'static str> {
    match file_type {
        FileType::Mpeg => Some("MPEG Audio"),
        FileType::Aac => Some("AAC"),
        FileType::Vorbis => Some("Vorbis"),
        FileType::Flac => Some("FLAC"),
        FileType::Mp4 | FileType::Wav => None,
        _ => None,
    }
}

fn tag_text(tag: &Tag, key: &ItemKey) -> Option<String> {
    tag.get_string(*key)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn tag_number(tag: &Tag, key: &ItemKey) -> Option<i64> {
    tag_text(tag, key)?.split('/').next()?.trim().parse().ok()
}
