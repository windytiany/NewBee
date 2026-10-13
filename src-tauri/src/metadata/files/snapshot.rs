use crate::artwork::model::ArtworkContent;
use crate::database::model::TrackWriteInput;
use lofty::{
    file::FileType,
    picture::PictureType,
    prelude::*,
    tag::{ItemKey, Tag, TagType},
};
use std::path::Path;

pub(crate) fn read_track(path: &Path) -> Result<Option<TrackWriteInput>, String> {
    read_snapshot(path, true)
}

pub(crate) fn read_track_metadata(path: &Path) -> Result<Option<TrackWriteInput>, String> {
    read_snapshot(path, false)
}

fn read_snapshot(path: &Path, include_artwork: bool) -> Result<Option<TrackWriteInput>, String> {
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
    let (title, artist, album, album_artist, release_date, disc_number, track_number, artwork) =
        match tag {
            Some(tag) => (
                tag_text(tag, &ItemKey::TrackTitle),
                tag_text(tag, &ItemKey::TrackArtist),
                tag_text(tag, &ItemKey::AlbumTitle),
                tag_text(tag, &ItemKey::AlbumArtist),
                tag_text(tag, &ItemKey::RecordingDate)
                    .or_else(|| tag_text(tag, &ItemKey::ReleaseDate)),
                tag_number(tag, &ItemKey::DiscNumber),
                tag_number(tag, &ItemKey::TrackNumber),
                if include_artwork {
                    read_artwork(tag)?
                } else {
                    None
                },
            ),
            None => (None, None, None, None, None, None, None, None),
        };

    let mut artwork = artwork;
    if include_artwork && artwork.is_none() {
        for other in tagged_file
            .tags()
            .iter()
            .filter(|other| other.tag_type() != editing_tag.tag_type())
        {
            if let Some(found) = read_artwork(other)? {
                artwork = Some(found);
                break;
            }
        }
    }

    let duration_ms = i64::try_from(properties.duration().as_millis())
        .ok()
        .filter(|duration| *duration > 0);

    Ok(Some(TrackWriteInput {
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
        artwork,
        editing: Some(editing),
        lyrics: crate::metadata::files::lyrics::embedded_lyrics_text(&tagged_file)
            .map(str::to_owned),
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

pub(super) fn read_artwork(tag: &Tag) -> Result<Option<ArtworkContent>, String> {
    let picture = if tag.tag_type() == TagType::Mp4Ilst {
        tag.pictures().first()
    } else {
        tag.pictures()
            .iter()
            .find(|picture| picture.pic_type() == PictureType::CoverFront)
    };
    let Some(picture) = picture else {
        return Ok(None);
    };
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .ok_or_else(|| "embedded artwork has no recognized MIME type".to_owned())?;

    Ok(Some(ArtworkContent {
        mime_type,
        image: picture.data().to_vec(),
    }))
}
