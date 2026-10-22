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

pub(crate) fn embedded(image: Option<&[u8]>) -> crate::artwork::track::Scan {
    crate::artwork::track::Scan {
        embedded: Ok(image
            .iter()
            .map(|content| crate::artwork::track::Picture {
                content: crate::artwork::model::ArtworkContent {
                    mime_type: "image/png".into(),
                    image: content.to_vec(),
                },
                picture_type: 3,
            })
            .collect()),
        directory: Ok(Vec::new()),
    }
}

/// Publish a supplied fixture snapshot and Inbox membership through the database interface.
pub(crate) fn inbox(
    database: &Database,
    track: &crate::tracks::model::TrackWriteInput,
    scan: crate::artwork::track::Scan,
) -> Result<i64, String> {
    database.save_inbox_snapshot(&crate::tracks::model::Snapshot {
        track: track.clone(),
        artwork: scan,
        linked: Vec::new(),
    })
}
