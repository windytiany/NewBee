use super::{LyricsCandidate, LyricsContent, LyricsSearchResults};
use reqwest::blocking::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NeteaseLyricsMode {
    #[default]
    Original,
    Translated,
    Bilingual,
}

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
    #[serde(default)]
    tlyric: Option<LyricText>,
}
#[derive(Deserialize)]
struct LyricText {
    lyric: Option<String>,
}

pub(super) fn lyrics(id: i64, mode: NeteaseLyricsMode) -> Result<LyricsContent, String> {
    let response: LyricResponse = request(|client| {
        client
            .get("https://music.163.com/api/song/lyric")
            .header("Referer", "https://music.163.com/")
            .query(&[
                ("id", id.to_string()),
                ("lv", "-1".to_owned()),
                ("kv", "1".to_owned()),
                ("tv", "-1".to_owned()),
            ])
            .send()
    })?;
    decode_lyrics(response, mode)
}

fn decode_lyrics(
    response: LyricResponse,
    mode: NeteaseLyricsMode,
) -> Result<LyricsContent, String> {
    if response.code != 200 {
        return Err(format!("网易云歌词请求失败（{}）", response.code));
    }
    if response.nolyric || response.pure_music {
        return Ok(LyricsContent::Instrumental);
    }
    let original = response
        .lrc
        .and_then(|lyric| lyric.lyric)
        .filter(|text| !text.trim().is_empty());
    let translated = response
        .tlyric
        .and_then(|lyric| lyric.lyric)
        .filter(|text| !text.trim().is_empty());
    let text = match mode {
        NeteaseLyricsMode::Original => original,
        NeteaseLyricsMode::Translated => translated.or(original),
        NeteaseLyricsMode::Bilingual => match (original, translated) {
            (Some(original), Some(translated)) => {
                if original.contains('\0') || translated.contains('\0') {
                    return Err("网易云歌词包含无效字符".to_owned());
                }
                Some(bilingual_lyrics(&original, &translated))
            }
            (original, _) => original,
        },
    };
    match text {
        Some(text) if text.contains('\0') => Err("网易云歌词包含无效字符".to_owned()),
        Some(text) => Ok(LyricsContent::Available { text }),
        None => Ok(LyricsContent::Missing),
    }
}

fn bilingual_lyrics(original: &str, translated: &str) -> String {
    use crate::lyrics::{parse_embedded_lyrics, TrackLyrics};

    if let TrackLyrics::Synced { lines } = parse_embedded_lyrics(original) {
        let mut translations = std::collections::BTreeMap::new();
        if let TrackLyrics::Synced { lines } = parse_embedded_lyrics(translated) {
            for line in lines {
                if !line.text.trim().is_empty() {
                    translations.entry(line.start_ms).or_insert(line.text);
                }
            }
        }
        return lines
            .into_iter()
            .map(|line| {
                let text = match translations.get(&line.start_ms) {
                    Some(translation) => format!("{} / {}", line.text, translation.trim()),
                    None => line.text,
                };
                format!(
                    "[{:02}:{:02}.{:03}]{text}",
                    line.start_ms / 60_000,
                    line.start_ms / 1_000 % 60,
                    line.start_ms % 1_000,
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
    }

    let mut translations = translated.lines();
    original
        .lines()
        .map(|line| {
            let translation = translations.next().unwrap_or_default();
            let text = match parse_embedded_lyrics(translation) {
                TrackLyrics::Synced { lines } => lines
                    .into_iter()
                    .next()
                    .map(|line| line.text)
                    .unwrap_or_default(),
                TrackLyrics::Plain { text } => text,
                TrackLyrics::None | TrackLyrics::Instrumental => String::new(),
            };
            if text.trim().is_empty() {
                line.to_owned()
            } else {
                format!("{line} / {}", text.trim())
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
#[path = "../tests/netease.rs"]
mod tests;
