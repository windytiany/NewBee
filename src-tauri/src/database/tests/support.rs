use super::super::Database;
use rusqlite::params;

pub(super) fn insert_track(
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
            "INSERT INTO tracks (id, path, album, album_artist, track_number)
             VALUES (?1, ?2, ?3, ?4, ?5)",
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
        connection.execute("INSERT INTO artwork_images (mime_type, image) VALUES ('image/png', ?1) ON CONFLICT(image) DO NOTHING", [image]).unwrap();
        connection.execute("INSERT INTO track_artwork (track_id, image_id, source_kind, source_path) SELECT ?1, id, 'embedded', ?2 FROM artwork_images WHERE image = ?3", params![id, format!("track-{id}.mp3"), image]).unwrap();
    }
}
