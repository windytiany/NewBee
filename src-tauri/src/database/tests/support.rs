use super::super::Database;
use rusqlite::params;

pub(crate) fn insert_track(
    database: &Database,
    id: i64,
    album_artist: Option<&str>,
    album: Option<&str>,
    track_number: i64,
    artwork: Option<&[u8]>,
) {
    let connection = database.connection().unwrap();
    connection
        .execute(
            "INSERT INTO tracks (id, path, album, album_artist, track_number, in_library)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            params![
                id,
                format!("track-{id}.mp3"),
                album,
                album_artist,
                track_number
            ],
        )
        .unwrap();

    if let Some(image) = artwork {
        let image_id = super::super::artwork::persist_image(
            &connection,
            &crate::artwork::model::ArtworkContent {
                mime_type: "image/png".into(),
                image: image.to_vec(),
            },
        )
        .unwrap();
        connection.execute("INSERT INTO track_artwork (track_id, image_id, picture_type, is_display) VALUES (?1, ?2, 3, 1)", params![id, image_id]).unwrap();
        let artwork_id = connection.last_insert_rowid();
        connection.execute("INSERT INTO track_artwork_sources (artwork_id, source_kind, source_path, picture_type) VALUES (?1, 'embedded', ?2, 3)", params![artwork_id, format!("track-{id}.mp3")]).unwrap();
    }
}

pub(crate) fn embedded(
    track: &crate::database::model::TrackWriteInput,
) -> crate::artwork::collection::Scan {
    crate::artwork::collection::Scan {
        embedded: Ok(track
            .artwork
            .iter()
            .map(|content| crate::artwork::collection::Picture {
                content: content.clone(),
                picture_type: 3,
            })
            .collect()),
        directory: Ok(Vec::new()),
    }
}

pub(crate) fn directory(
    track: &crate::database::model::TrackWriteInput,
    path: &str,
) -> crate::artwork::collection::Scan {
    crate::artwork::collection::Scan {
        embedded: Ok(Vec::new()),
        directory: Ok(track
            .artwork
            .iter()
            .map(|content| crate::artwork::collection::DirectoryPicture {
                path: path.into(),
                content: Ok(content.clone()),
            })
            .collect()),
    }
}
