use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

pub(in crate::database::schema) fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    // Foreign keys must be disabled outside the transaction to rebuild the BLOB
    // unique index without changing the track associations or original bytes.
    connection.pragma_update(None, "foreign_keys", false)?;
    let result = rebuild(connection);
    connection.pragma_update(None, "foreign_keys", true)?;
    result?;
    // The version is advanced only after VACUUM. An interrupted/failed reclaim
    // retries on the next open; rebuild detects an already migrated table.
    connection.execute_batch("VACUUM;")
}

fn rebuild(connection: &mut Connection) -> rusqlite::Result<()> {
    let has_digest: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('artwork_images') WHERE name = 'digest')",
        [],
        |row| row.get(0),
    )?;
    let transaction = connection.transaction()?;
    if !has_digest {
        let sequence: i64 = transaction.query_row(
            "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'artwork_images'), 0)",
            [],
            |row| row.get(0),
        )?;
        transaction.execute_batch(
            "DROP TRIGGER IF EXISTS remove_unreferenced_artwork_after_delete;
             DROP TRIGGER IF EXISTS remove_unreferenced_artwork_after_replace;
             DROP TABLE IF EXISTS artwork_thumbnails;
             CREATE TABLE artwork_images_next (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 mime_type TEXT NOT NULL,
                 digest BLOB NOT NULL CHECK (length(digest) = 32),
                 content_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
                 image BLOB NOT NULL
             );",
        )?;
        {
            let mut statement =
                transaction.prepare("SELECT id, mime_type, image FROM artwork_images")?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let image: Vec<u8> = row.get(2)?;
                transaction.execute(
                    "INSERT INTO artwork_images_next (id, mime_type, digest, image) VALUES (?1, ?2, ?3, ?4)",
                    params![row.get::<_, i64>(0)?, row.get::<_, String>(1)?, Sha256::digest(&image).as_slice(), image],
                )?;
            }
        }
        transaction.execute_batch(
            "DROP TABLE artwork_images;
             ALTER TABLE artwork_images_next RENAME TO artwork_images;",
        )?;
        transaction.execute(
            "UPDATE sqlite_sequence SET seq = MAX(seq, ?1) WHERE name = 'artwork_images'",
            [sequence],
        )?;
    }
    transaction.execute_batch(super::super::definition())?;
    let mut foreign_keys = transaction.prepare("PRAGMA foreign_key_check")?;
    if foreign_keys.exists([])? {
        return Err(rusqlite::Error::InvalidQuery);
    }
    drop(foreign_keys);
    transaction.commit()
}
