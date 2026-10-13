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
        connection.execute("INSERT INTO track_artwork (track_id, image_id, source_kind, source_path) VALUES (?1, ?2, 'embedded', ?3)", params![id, image_id, format!("track-{id}.mp3")]).unwrap();
    }
}
