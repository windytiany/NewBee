use crate::database::Database;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Revision {
    pub(crate) track_id: i64,
    pub(crate) value: String,
}

pub(crate) fn read(database: &Database, id: i64) -> Result<String, String> {
    let track = database.get_track(id)?.ok_or("曲目已不存在")?;
    let lyrics = database.get_lyrics(id)?;
    // Editing reads remain database-only, including when the source disk is offline.
    // JSON values canonicalize map keys before hashing the stored editing snapshot.
    let snapshot = serde_json::json!([
        track,
        database.get_editing_snapshot(id)?,
        lyrics.text,
        lyrics.no_lyrics,
        database.describe_artwork_collections(&[id])?,
    ]);
    Ok(
        Sha256::digest(serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}
