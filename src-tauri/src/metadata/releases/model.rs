use serde::{Deserialize, Serialize};

#[derive(Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub(super) struct Credit {
    #[serde(default)]
    name: String,
    #[serde(default)]
    joinphrase: String,
    artist: Option<Artist>,
}
#[derive(Deserialize)]
struct Artist {
    name: String,
}
fn credited(credits: &[Credit]) -> Option<String> {
    let value: String = credits
        .iter()
        .map(|credit| {
            let name = if credit.name.is_empty() {
                credit
                    .artist
                    .as_ref()
                    .map_or("", |artist| artist.name.as_str())
            } else {
                &credit.name
            };
            format!("{name}{}", credit.joinphrase)
        })
        .collect();
    (!value.trim().is_empty()).then_some(value)
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) struct RawRelease {
    id: String,
    title: String,
    date: Option<String>,
    country: Option<String>,
    status: Option<String>,
    disambiguation: Option<String>,
    #[serde(default)]
    artist_credit: Vec<Credit>,
    #[serde(default)]
    media: Vec<Medium>,
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct Medium {
    position: Option<u32>,
    format: Option<String>,
    track_count: u32,
    #[serde(default)]
    tracks: Vec<RawTrack>,
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct RawTrack {
    title: String,
    position: u32,
    length: Option<u64>,
    #[serde(default)]
    artist_credit: Vec<Credit>,
}
#[derive(Deserialize)]
pub(super) struct RawSearch {
    pub count: u32,
    pub offset: u32,
    pub releases: Vec<RawRelease>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseSummary {
    id: String,
    title: String,
    artist: Option<String>,
    release_date: Option<String>,
    country: Option<String>,
    status: Option<String>,
    disambiguation: Option<String>,
    formats: Vec<String>,
    disc_count: usize,
    track_count: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseTrack {
    title: String,
    artist: Option<String>,
    disc_number: u32,
    track_number: u32,
    track_total: u32,
    duration_ms: Option<u64>,
}
#[derive(Serialize)]
pub(crate) struct ReleaseDetails {
    summary: ReleaseSummary,
    tracks: Vec<ReleaseTrack>,
}
impl RawRelease {
    pub(super) fn summary(&self) -> ReleaseSummary {
        ReleaseSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            artist: credited(&self.artist_credit),
            release_date: self.date.clone().filter(|value| !value.is_empty()),
            country: self.country.clone(),
            status: self.status.clone(),
            disambiguation: self.disambiguation.clone(),
            formats: self
                .media
                .iter()
                .filter_map(|medium| medium.format.clone())
                .collect(),
            disc_count: self.media.len(),
            track_count: self.media.iter().map(|medium| medium.track_count).sum(),
        }
    }
    pub(super) fn details(self) -> Result<ReleaseDetails, String> {
        let summary = self.summary();
        let mut tracks = Vec::new();
        for (index, medium) in self.media.into_iter().enumerate() {
            let disc_number = medium.position.unwrap_or(index as u32 + 1);
            for track in medium.tracks {
                if disc_number == 0 || track.position == 0 || track.position > medium.track_count {
                    return Err("MusicBrainz 返回了无效曲目编号".to_owned());
                }
                tracks.push(ReleaseTrack {
                    title: track.title,
                    artist: credited(&track.artist_credit),
                    disc_number,
                    track_number: track.position,
                    track_total: medium.track_count,
                    duration_ms: track.length,
                });
            }
        }
        tracks.sort_by_key(|track| (track.disc_number, track.track_number));
        if tracks.is_empty() {
            return Err("该发行版本没有可用的曲目列表".to_owned());
        }
        Ok(ReleaseDetails { summary, tracks })
    }
}
#[derive(Serialize)]
pub(crate) struct SearchResults {
    pub count: u32,
    pub offset: u32,
    pub releases: Vec<ReleaseSummary>,
}
#[derive(Deserialize)]
pub(super) struct RawCovers {
    pub images: Vec<RawCover>,
}
#[derive(Deserialize)]
pub(super) struct RawCover {
    #[serde(deserialize_with = "image_id")]
    pub id: String,
    pub front: bool,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub comment: String,
}
fn image_id<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Id {
        Number(u64),
        Text(String),
    }
    Ok(match Id::deserialize(deserializer)? {
        Id::Number(number) => number.to_string(),
        Id::Text(value) => value,
    })
}
#[derive(Serialize)]
pub(crate) struct CoverChoice {
    pub id: String,
    pub comment: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CoverData {
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[cfg(test)]
#[path = "tests/model.rs"]
mod tests;
