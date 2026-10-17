use rusqlite::{types::Value, OptionalExtension, Transaction};

#[derive(PartialEq)]
pub(super) struct State {
    metadata: Vec<Vec<Value>>,
    editing: Option<serde_json::Value>,
    artwork: Vec<Vec<Value>>,
}

impl State {
    pub(super) fn read(transaction: &Transaction<'_>, path: &str) -> Result<Self, String> {
        // Compare persisted content, not revisions or generated artwork identities.
        let metadata = rows(
            transaction,
            "SELECT t.title, t.artist, t.album, t.album_artist, t.release_date,
                    t.disc_number, t.track_number, t.disc_total, t.track_total,
                    t.duration_ms, t.codec, t.sample_rate_hz, t.bitrate_kbps, t.channels,
                    l.text, l.no_lyrics, e.scan_issue,
                    EXISTS(SELECT 1 FROM track_artwork_pending WHERE track_id = t.id)
             FROM tracks t
             LEFT JOIN track_lyrics l ON l.track_id = t.id
             LEFT JOIN track_editing e ON e.track_id = t.id
             WHERE t.path = ?1",
            path,
        )?;
        let editing: Option<String> = transaction
            .query_row(
                "SELECT e.snapshot FROM track_editing e JOIN tracks t ON t.id = e.track_id
                 WHERE t.path = ?1",
                [path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let editing = editing
            .map(|snapshot| serde_json::from_str(&snapshot))
            .transpose()
            .map_err(|error| format!("Failed to compare editing snapshot: {error}"))?;
        let artwork = rows(
            transaction,
            "SELECT i.digest, i.mime_type, a.picture_type, a.is_display, a.source_error,
                    s.source_kind, s.source_path, s.picture_type
             FROM tracks t
             JOIN track_artwork a ON a.track_id = t.id
             JOIN artwork_images i ON i.id = a.image_id
             LEFT JOIN track_artwork_sources s ON s.artwork_id = a.id
             WHERE t.path = ?1
             ORDER BY i.digest, i.mime_type, a.picture_type, a.is_display, a.source_error,
                      s.source_kind, s.source_path, s.picture_type",
            path,
        )?;
        Ok(Self {
            metadata,
            editing,
            artwork,
        })
    }
}

fn rows(transaction: &Transaction<'_>, sql: &str, path: &str) -> Result<Vec<Vec<Value>>, String> {
    let mut statement = transaction
        .prepare(sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([path], |row| {
            (0..row.as_ref().column_count())
                .map(|index| row.get(index))
                .collect::<rusqlite::Result<Vec<Value>>>()
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}
