use serde::Serialize;

#[derive(Debug, Clone)]
pub struct ArtworkContent {
    pub mime_type: String,
    pub image: Vec<u8>,
}

#[derive(Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrackArtwork {
    Available { mime_type: String, data: Vec<u8> },
    NoArtwork,
}
