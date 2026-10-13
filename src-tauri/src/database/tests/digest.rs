use super::*;
use crate::database::Database;
use sha2::{Digest, Sha256};

fn artwork(bytes: &[u8]) -> ArtworkContent {
    ArtworkContent {
        mime_type: "image/png".into(),
        image: bytes.to_vec(),
    }
}

#[test]
fn digest_candidates_compare_full_bytes_and_keep_collisions_distinct() {
    let database = Database::open(":memory:").unwrap();
    let mut connection = database.connection().unwrap();
    let transaction = connection.transaction().unwrap();
    let digest = [7; 32];
    let first = persist_digest(&transaction, &artwork(b"first"), &digest).unwrap();
    let second = persist_digest(&transaction, &artwork(b"second"), &digest).unwrap();
    assert_ne!(first, second);
    assert_eq!(
        persist_digest(&transaction, &artwork(b"first"), &digest).unwrap(),
        first
    );
    assert_eq!(
        persist_digest(&transaction, &artwork(b"second"), &digest).unwrap(),
        second
    );
    let keys: Vec<String> = transaction
        .prepare("SELECT lower(hex(digest)) || '-' || content_id FROM artwork_images ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_ne!(keys[0], keys[1]);
    transaction
        .execute_batch("INSERT INTO tracks (id, path) VALUES (1, 'first.mp3'), (2, 'second.mp3');")
        .unwrap();
    for (track, image) in [(1, first), (2, second)] {
        transaction
            .execute(
                "INSERT INTO track_artwork (track_id, image_id, picture_type, is_display) VALUES (?1, ?2, 3, 1)",
                params![track, image],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
    drop(connection);
    for (track, original, encoded) in [
        (1, b"first".as_slice(), b"first thumbnail".as_slice()),
        (2, b"second".as_slice(), b"second thumbnail".as_slice()),
    ] {
        assert_eq!(
            database
                .track_artwork_bytes(track, Some(128), |bytes, _| {
                    assert_eq!(bytes, original);
                    Ok(encoded.to_vec())
                })
                .unwrap(),
            encoded
        );
        assert_eq!(
            database
                .track_artwork_bytes(track, Some(128), |_, _| panic!(
                    "collision cache regenerated"
                ))
                .unwrap(),
            encoded
        );
    }
}

#[test]
fn stores_sha256_without_changing_original_bytes_or_building_a_blob_index() {
    let database = Database::open(":memory:").unwrap();
    let connection = database.connection().unwrap();
    let original = artwork(b"original snapshot");
    let first = persist_image(&connection, &original).unwrap();
    assert_eq!(persist_image(&connection, &original).unwrap(), first);
    let (digest, image): (Vec<u8>, Vec<u8>) = connection
        .query_row(
            "SELECT digest, image FROM artwork_images WHERE id = ?1",
            [first],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(digest, Sha256::digest(&original.image).to_vec());
    assert_eq!(image, original.image);
    let indexes: Vec<String> = connection
        .prepare("SELECT name FROM pragma_index_list('artwork_images')")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    for index in indexes {
        let columns: Vec<String> = connection
            .prepare("SELECT name FROM pragma_index_info(?1)")
            .unwrap()
            .query_map([index], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(!columns.iter().any(|column| column == "image"));
    }
}
