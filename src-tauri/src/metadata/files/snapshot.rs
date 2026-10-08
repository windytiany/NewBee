use crate::database::{EmbeddedArtwork, TrackWriteInput};
use lofty::{
    file::FileType,
    picture::PictureType,
    prelude::*,
    tag::{ItemKey, Tag},
};
use std::path::Path;

pub(crate) fn read_track(path: &Path) -> Result<Option<TrackWriteInput>, String> {
    let tagged_file = super::read_file(path)?;
    let readonly = super::file_metadata(path)
        .map_err(|error| error.to_string())?
        .permissions()
        .readonly();
    let editing = super::metadata_from_file(&tagged_file, readonly);
    let file_type = tagged_file.file_type();
    if !is_supported_file_type(file_type) {
        return Ok(None);
    }

    let properties = tagged_file.properties();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());
    let (title, artist, album, album_artist, release_date, disc_number, track_number, artwork) =
        match tag {
            Some(tag) => (
                tag_text(tag, &ItemKey::TrackTitle),
                tag_text(tag, &ItemKey::TrackArtist),
                tag_text(tag, &ItemKey::AlbumTitle),
                tag_text(tag, &ItemKey::AlbumArtist),
                tag_text(tag, &ItemKey::ReleaseDate)
                    .or_else(|| tag_text(tag, &ItemKey::RecordingDate)),
                tag_number(tag, &ItemKey::DiscNumber),
                tag_number(tag, &ItemKey::TrackNumber),
                read_artwork(tag)?,
            ),
            None => (None, None, None, None, None, None, None, None),
        };

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
        editing: Some(serde_json::to_string(&editing).map_err(|error| error.to_string())?),
        lyrics: crate::lyrics::local::embedded_lyrics_text(&tagged_file).map(str::to_owned),
    }))
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

fn read_artwork(tag: &Tag) -> Result<Option<EmbeddedArtwork>, String> {
    let picture = tag
        .pictures()
        .iter()
        .find(|picture| picture.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first());
    let Some(picture) = picture else {
        return Ok(None);
    };
    let mime_type = picture
        .mime_type()
        .map(ToString::to_string)
        .ok_or_else(|| "embedded artwork has no recognized MIME type".to_owned())?;

    Ok(Some(EmbeddedArtwork {
        mime_type,
        image: picture.data().to_vec(),
    }))
}
