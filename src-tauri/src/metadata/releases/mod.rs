mod model;
pub(crate) mod save;
use crate::metadata::{files::MAX_COVER_BYTES, model::valid_musicbrainz_id as valid_id};
pub(crate) use model::CoverData;
use model::{CoverChoice, RawCovers, RawRelease, RawSearch, ReleaseDetails, SearchResults};
use reqwest::blocking::{Client, Response};
use serde::de::DeserializeOwned;
use std::{
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_JSON_BYTES: u64 = 8 * 1024 * 1024;
static CLIENT: OnceLock<Client> = OnceLock::new();
static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

fn client() -> Result<&'static Client, String> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .user_agent(concat!(
            "NewBee/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/windytiany/NewBee)"
        ))
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("创建网络连接失败：{error}"))?;
    let _ = CLIENT.set(client);
    CLIENT.get().ok_or_else(|| "创建网络连接失败".to_owned())
}
fn json<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let response = response
        .error_for_status()
        .map_err(|error| format!("请求失败，可稍后重试：{error}"))?;
    let mut bytes = Vec::new();
    response
        .take(MAX_JSON_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if bytes.len() as u64 > MAX_JSON_BYTES {
        return Err("响应数据过大".to_owned());
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("解析远程数据失败：{error}"))
}
fn musicbrainz<T: DeserializeOwned>(path: &str, query: &[(&str, String)]) -> Result<T, String> {
    let mut last = LAST_REQUEST.lock().map_err(|error| error.to_string())?;
    if let Some(instant) = *last {
        let elapsed = instant.elapsed();
        if elapsed < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_secs(1) - elapsed);
        }
    }
    *last = Some(Instant::now());
    // Serialize requests as well as their starts; all commands share the same limiter.
    let response = client()?
        .get(format!("https://musicbrainz.org/ws/2/{path}"))
        .query(query)
        .query(&[("fmt", "json")])
        .send()
        .map_err(|error| format!("MusicBrainz 连接失败，可重试：{error}"))?;
    json(response)
}
fn validate_id(value: &str) -> Result<(), String> {
    if valid_id(value) {
        Ok(())
    } else {
        Err("请输入有效的 MusicBrainz 发行版本 ID".to_owned())
    }
}
fn literal(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        if "+-!(){}[]^\"~*?:\\/&|".contains(character) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    format!("\"{escaped}\"")
}

#[tauri::command]
pub(crate) async fn search_album_releases(
    artist: String,
    album: String,
    offset: u32,
) -> Result<SearchResults, String> {
    if artist.len() > 1000 || album.len() > 1000 || offset > 100_000 {
        return Err("搜索条件过长或页码无效".to_owned());
    }
    let mut terms = Vec::new();
    if !artist.trim().is_empty() {
        terms.push(format!("artist:{}", literal(artist.trim())));
    }
    if !album.trim().is_empty() {
        terms.push(format!("release:{}", literal(album.trim())));
    }
    if terms.is_empty() {
        return Err("请填写艺术家或专辑名".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let raw: RawSearch = musicbrainz(
            "release/",
            &[
                ("query", terms.join(" AND ")),
                ("limit", "25".to_owned()),
                ("offset", offset.to_string()),
            ],
        )?;
        Ok(SearchResults {
            count: raw.count,
            offset: raw.offset,
            releases: raw.releases.iter().map(RawRelease::summary).collect(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub(crate) async fn get_album_release(release_id: String) -> Result<ReleaseDetails, String> {
    validate_id(&release_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let raw: RawRelease = musicbrainz(
            &format!("release/{release_id}"),
            &[(
                "inc",
                "recordings+artist-credits+release-groups+labels".to_owned(),
            )],
        )?;
        raw.details()
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub(crate) async fn get_release_covers(release_id: String) -> Result<Vec<CoverChoice>, String> {
    validate_id(&release_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let response = client()?
            .get(format!("https://coverartarchive.org/release/{release_id}"))
            .send()
            .map_err(|error| format!("封面查询失败：{error}"))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        let raw: RawCovers = json(response)?;
        Ok(raw
            .images
            .into_iter()
            .filter(|image| image.front || image.types.iter().any(|kind| kind == "Front"))
            .filter(|image| {
                !image.id.is_empty() && image.id.bytes().all(|byte| byte.is_ascii_digit())
            })
            .map(|image| CoverChoice {
                id: image.id,
                comment: image.comment,
            })
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
pub(crate) async fn get_release_cover(
    release_id: String,
    cover_id: String,
) -> Result<CoverData, String> {
    validate_id(&release_id)?;
    if cover_id.is_empty()
        || cover_id.len() > 30
        || !cover_id.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("封面 ID 无效".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = client()?
            .get(format!(
                "https://coverartarchive.org/release/{release_id}/{cover_id}"
            ))
            .send()
            .and_then(Response::error_for_status)
            .map_err(|error| format!("封面下载失败，可重试：{error}"))?;
        let mut data = Vec::new();
        response
            .take(MAX_COVER_BYTES as u64 + 1)
            .read_to_end(&mut data)
            .map_err(|error| format!("读取封面失败：{error}"))?;
        let picture = crate::metadata::files::cover_picture(&data)?;
        let mime_type = picture
            .mime_type()
            .ok_or_else(|| "无法识别封面格式".to_owned())?
            .to_string();
        Ok(CoverData { mime_type, data })
    })
    .await
    .map_err(|error| error.to_string())?
}
