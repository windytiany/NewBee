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
        connection
            .execute(
                "INSERT INTO track_artwork (track_id, mime_type, image)
                 VALUES (?1, 'image/png', ?2)",
                params![id, image],
            )
            .unwrap();
    }
}
