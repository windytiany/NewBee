use reqwest::blocking::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize};
use std::{
    io::Read,
    time::{Duration, Instant},
};

const API: &str = "https://api.discogs.com";
const MAX_JSON_BYTES: u64 = 2 * 1024 * 1024;
const REQUEST_INTERVAL: Duration = Duration::from_secs(3);
const RATE_LIMIT_DELAY: Duration = Duration::from_secs(60);

#[derive(Default)]
pub(super) struct Discogs {
    client: Option<Client>,
    next_request: Option<Instant>,
}

#[derive(Deserialize)]
struct Search {
    results: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    id: u64,
    title: String,
}

#[derive(Deserialize)]
struct Artist {
    name: String,
    #[serde(default)]
    namevariations: Vec<String>,
    #[serde(default)]
    images: Vec<Photo>,
}

#[derive(Deserialize)]
struct Photo {
    #[serde(rename = "type")]
    kind: String,
    uri: String,
}

fn normalized(name: &str) -> String {
    let name = name.trim();
    let name = name
        .rsplit_once(" (")
        .filter(|(_, suffix)| {
            suffix.strip_suffix(')').is_some_and(|number| {
                !number.is_empty() && number.chars().all(|character| character.is_ascii_digit())
            })
        })
        .map_or(name, |(name, _)| name);
    name.to_lowercase()
}

fn select(
    name: &str,
    mut candidates: Vec<Candidate>,
    mut detail: impl FnMut(u64) -> Result<Artist, String>,
) -> Result<Option<String>, String> {
    let name = normalized(name);
    candidates.truncate(5);
    candidates.sort_by_key(|candidate| normalized(&candidate.title) != name);
    for candidate in candidates {
        if candidate.id == 0 {
            return Err("Discogs 演出者 ID 无效".into());
        }
        let artist = detail(candidate.id)?;
        if normalized(&artist.name) != name
            && !artist
                .namevariations
                .iter()
                .any(|variation| normalized(variation) == name)
        {
            continue;
        }
        return Ok(artist
            .images
            .iter()
            .find(|photo| photo.kind == "primary" && !photo.uri.is_empty())
            .or_else(|| artist.images.iter().find(|photo| !photo.uri.is_empty()))
            .map(|photo| photo.uri.clone()));
    }
    Ok(None)
}

fn bytes(response: Response, limit: u64) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    response
        .error_for_status()
        .map_err(|error| format!("Discogs 请求失败：{error}"))?
        .take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|error| format!("读取 Discogs 响应失败：{error}"))?;
    if data.len() as u64 > limit {
        return Err("Discogs 响应数据过大".into());
    }
    Ok(data)
}

impl Discogs {
    fn client(&mut self) -> Result<&Client, String> {
        if self.client.is_none() {
            self.client = Some(
                Client::builder()
                    .user_agent(concat!(
                        "NewBee/",
                        env!("CARGO_PKG_VERSION"),
                        " (https://github.com/windytiany/NewBee)"
                    ))
                    .timeout(Duration::from_secs(30))
                    .connect_timeout(Duration::from_secs(10))
                    .https_only(true)
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|error| format!("创建 Discogs 连接失败：{error}"))?,
            );
        }
        self.client
            .as_ref()
            .ok_or_else(|| "创建 Discogs 连接失败".into())
    }

    fn json<T: DeserializeOwned>(
        &mut self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<T, String> {
        if let Some(next) = self.next_request {
            std::thread::sleep(next.saturating_duration_since(Instant::now()));
        }
        self.next_request = Some(Instant::now() + REQUEST_INTERVAL);
        let response = self
            .client()?
            .get(format!("{API}{path}"))
            .query(query)
            .send()
            .map_err(|error| format!("Discogs 请求失败：{error}"))?;
        let limited = response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            || response
                .headers()
                .get("X-Discogs-Ratelimit-Remaining")
                .is_some_and(|value| value == "0");
        if limited {
            let delay = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(Duration::from_secs)
                .unwrap_or(RATE_LIMIT_DELAY)
                .max(RATE_LIMIT_DELAY);
            self.next_request = Instant::now().checked_add(delay);
            if self.next_request.is_none() {
                self.next_request = Some(Instant::now() + RATE_LIMIT_DELAY);
            }
        }
        serde_json::from_slice(&bytes(response, MAX_JSON_BYTES)?)
            .map_err(|error| format!("解析 Discogs 数据失败：{error}"))
    }

    pub(super) fn find(&mut self, name: &str) -> Result<Option<Vec<u8>>, String> {
        let search: Search = self.json(
            "/database/search",
            &[("q", name), ("type", "artist"), ("per_page", "5")],
        )?;
        let Some(uri) = select(name, search.results, |id| {
            self.json(&format!("/artists/{id}"), &[])
        })?
        else {
            return Ok(None);
        };
        let url =
            reqwest::Url::parse(&uri).map_err(|error| format!("Discogs 图片地址无效：{error}"))?;
        if url.scheme() != "https" || url.host_str() != Some("i.discogs.com") {
            return Err("Discogs 图片地址无效".into());
        }
        let response = self
            .client()?
            .get(url)
            .send()
            .map_err(|error| format!("下载 Discogs 图片失败：{error}"))?;
        bytes(response, super::storage::MAX_PHOTO_BYTES as u64).map(Some)
    }
}
