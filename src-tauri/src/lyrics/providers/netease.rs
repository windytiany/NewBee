use super::{LyricsCandidate, LyricsContent, LyricsSearchResults};
use reqwest::blocking::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize};
use std::{
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const PAGE_SIZE: u32 = 30;
static CLIENT: OnceLock<Client> = OnceLock::new();
static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

fn client() -> Result<&'static Client, String> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .user_agent(concat!("NewBee/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| format!("创建网易云连接失败：{error}"))?;
    let _ = CLIENT.set(client);
    CLIENT.get().ok_or_else(|| "创建网易云连接失败".to_owned())
}

fn request<T: DeserializeOwned>(
    send: impl FnOnce(&Client) -> Result<Response, reqwest::Error>,
) -> Result<T, String> {
    // All search/preview/batch requests share a limiter, including their response reads.
    let mut last = LAST_REQUEST.lock().map_err(|error| error.to_string())?;
    if let Some(time) = *last {
        let interval = Duration::from_millis(350);
        std::thread::sleep(interval.saturating_sub(time.elapsed()));
    }
    *last = Some(Instant::now());
    let response = send(client()?)
        .and_then(Response::error_for_status)
        .map_err(|error| format!("网易云请求失败：{error}"))?;
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取网易云响应失败：{error}"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("网易云响应过大".to_owned());
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("解析网易云响应失败：{error}"))
}

#[derive(Deserialize)]
struct SearchResponse {
    code: i64,
    result: Option<SearchResult>,
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    #[serde(default)]
    songs: Vec<Song>,
    #[serde(default)]
    song_count: u32,
    #[serde(default)]
    has_more: bool,
}
#[derive(Deserialize)]
struct Song {
    id: i64,
    name: String,
    #[serde(default)]
    artists: Vec<Artist>,
    album: Option<Album>,
    duration: Option<u64>,
}
#[derive(Deserialize)]
struct Artist {
    name: String,
}
#[derive(Deserialize)]
struct Album {
    name: String,
}

pub(super) fn search(query: &str, offset: u32) -> Result<LyricsSearchResults, String> {
    let response: SearchResponse = request(|client| {
        client
            .post("https://music.163.com/api/search/get")
            .header("Referer", "https://music.163.com/")
            .body(format!(
                "s={}&type=1&limit={PAGE_SIZE}&offset={offset}",
                encode(query)
            ))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .send()
    })?;
    decode_search(response, offset)
}

// Encode the UTF-8 query as form data without relying on reqwest's optional form feature.
fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn decode_search(response: SearchResponse, offset: u32) -> Result<LyricsSearchResults, String> {
    if response.code != 200 {
        return Err(format!("网易云搜索失败（{}），请稍后重试", response.code));
    }
    let result = response.result.unwrap_or_default();
    let count = result.songs.len() as u32;
    let more = count > 0 && (result.has_more || offset.saturating_add(count) < result.song_count);
    Ok(LyricsSearchResults {
        candidates: result
            .songs
            .into_iter()
            .filter(|song| song.id > 0)
            .map(|song| LyricsCandidate {
                provider: super::LyricsProvider::Netease,
                id: song.id,
                title: song.name,
                artists: song.artists.into_iter().map(|artist| artist.name).collect(),
                album: song.album.map(|album| album.name).unwrap_or_default(),
                duration_ms: song.duration,
            })
            .collect(),
        next_offset: more.then(|| offset.saturating_add(count)),
    })
}

#[derive(Deserialize)]
struct LyricResponse {
    code: i64,
    #[serde(default)]
    nolyric: bool,
    #[serde(default, rename = "pureMusic")]
    pure_music: bool,
    lrc: Option<LyricText>,
}
#[derive(Deserialize)]
struct LyricText {
    lyric: Option<String>,
}

pub(super) fn lyrics(id: i64) -> Result<LyricsContent, String> {
    let response: LyricResponse = request(|client| {
        client
            .get("https://music.163.com/api/song/lyric")
            .header("Referer", "https://music.163.com/")
            .query(&[
                ("id", id.to_string()),
                ("lv", "-1".to_owned()),
                ("kv", "-1".to_owned()),
                ("tv", "-1".to_owned()),
            ])
            .send()
    })?;
    decode_lyrics(response)
}

fn decode_lyrics(response: LyricResponse) -> Result<LyricsContent, String> {
    if response.code != 200 {
        return Err(format!("网易云歌词请求失败（{}）", response.code));
    }
    if response.nolyric || response.pure_music {
        return Ok(LyricsContent::Instrumental);
    }
    match response.lrc.and_then(|lrc| lrc.lyric) {
        Some(text) if !text.trim().is_empty() => {
            if text.contains('\0') {
                return Err("网易云歌词包含无效字符".to_owned());
            }
            Ok(LyricsContent::Available { text })
        }
        _ => Ok(LyricsContent::Missing),
    }
}

#[cfg(test)]
#[path = "../tests/netease.rs"]
mod tests;
