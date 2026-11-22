//! B642: отправка сегментов записи интервью на сервер.
//!
//! Сегмент уходит multipart на `uploadUrl`, который выдал сервер для этой записи,
//! с одноразовым `X-Recording-Token`. После 2xx файл удаляется; если все попытки
//! не прошли — тоже удаляется: аудио на клиенте не хранится.

use std::path::Path;
use std::time::Duration;

const ORIGIN: &str = "https://openqareer.com";
const ROUTE_PREFIX: &str = "/api/v1/candidate/recordings/";
const ROUTE_SUFFIX: &str = "/segments";
const TOKEN_HEADER: &str = "X-Recording-Token";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Задержки перед попытками, мс: первая сразу, затем ещё две.
pub const RETRY_DELAYS_MS: [u64; 3] = [0, 2_000, 8_000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Track {
    Mic,
    System,
}

impl Track {
    pub fn as_str(self) -> &'static str {
        match self {
            Track::Mic => "mic",
            Track::System => "system",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SegmentMeta {
    pub track: Track,
    pub segment: u32,
    pub started_at: String,
    pub duration_ms: u64,
}

/// Куда и с каким заголовком отправлять сегменты одной записи.
#[derive(Debug, Clone)]
pub struct UploadTarget {
    url: String,
    headers: Vec<(String, String)>,
    https_only: bool,
}

impl UploadTarget {
    pub fn new(url: &str, headers: &[(String, String)]) -> Result<Self, String> {
        validate_upload_url(url)?;
        Ok(Self {
            url: url.to_string(),
            headers: upload_headers(headers)?,
            https_only: true,
        })
    }

    #[cfg(test)]
    pub fn for_tests(url: String, headers: Vec<(String, String)>) -> Self {
        Self {
            url,
            headers,
            https_only: false,
        }
    }
}

/// Только маршрут сегментов openqareer.com по https: аудио не уйдёт на чужой адрес.
pub fn validate_upload_url(url: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix(ORIGIN)
        .ok_or_else(|| "recording upload url is not openqareer.com".to_string())?;
    let id = rest
        .strip_prefix(ROUTE_PREFIX)
        .and_then(|tail| tail.strip_suffix(ROUTE_SUFFIX))
        .ok_or_else(|| "recording upload url is not the segments route".to_string())?;
    let id_ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if id_ok {
        Ok(())
    } else {
        Err("recording upload url has a malformed recording id".to_string())
    }
}

/// Из заголовков страницы берём только токен записи: cookie и Bearer сессии не нужны.
pub fn upload_headers(headers: &[(String, String)]) -> Result<Vec<(String, String)>, String> {
    let kept: Vec<(String, String)> = headers
        .iter()
        .filter(|(name, value)| name.eq_ignore_ascii_case(TOKEN_HEADER) && !value.is_empty())
        .map(|(_, value)| (TOKEN_HEADER.to_string(), value.clone()))
        .collect();
    if kept.is_empty() {
        Err("recording token header is missing".to_string())
    } else {
        Ok(kept)
    }
}

async fn send_once(
    client: &reqwest::Client,
    target: &UploadTarget,
    meta: &SegmentMeta,
    bytes: &[u8],
    file_name: &str,
) -> Result<(), String> {
    let part = reqwest::multipart::Part::bytes(bytes.to_vec())
        .file_name(file_name.to_string())
        .mime_str("audio/mp4")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("track", meta.track.as_str())
        .text("segment", meta.segment.to_string())
        .text("startedAt", meta.started_at.clone())
        .text("durationMs", meta.duration_ms.to_string())
        .part("file", part);
    let request = target
        .headers
        .iter()
        .fold(client.post(&target.url), |req, (name, value)| {
            req.header(name, value)
        });
    let response = request
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("status {}", response.status().as_u16()))
    }
}

/// Отправляет сегмент с повторами; файл удаляется в любом исходе. `true` — сервер принял.
pub async fn upload_segment(
    target: &UploadTarget,
    meta: &SegmentMeta,
    path: &Path,
    delays_ms: &[u64],
) -> bool {
    let sent = match tokio::fs::read(path).await {
        Ok(bytes) => send_with_retries(target, meta, &bytes, path, delays_ms).await,
        Err(error) => {
            eprintln!("recording: segment {} unreadable: {error}", meta.segment);
            false
        }
    };
    if let Err(error) = tokio::fs::remove_file(path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!("recording: segment {} not removed: {error}", meta.segment);
        }
    }
    sent
}

async fn send_with_retries(
    target: &UploadTarget,
    meta: &SegmentMeta,
    bytes: &[u8],
    path: &Path,
    delays_ms: &[u64],
) -> bool {
    // Без переходов: редирект увёл бы аудио и токен записи на другой хост.
    let client = match reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .https_only(target.https_only)
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("recording: http client: {error}");
            return false;
        }
    };
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("segment.m4a");
    let delays: &[u64] = if delays_ms.is_empty() {
        &[0]
    } else {
        delays_ms
    };
    for (attempt, delay) in delays.iter().enumerate() {
        if *delay > 0 {
            tokio::time::sleep(Duration::from_millis(*delay)).await;
        }
        match send_once(&client, target, meta, bytes, file_name).await {
            Ok(()) => return true,
            Err(error) => eprintln!(
                "recording: {} segment {} attempt {} failed: {error}",
                meta.track.as_str(),
                meta.segment,
                attempt + 1
            ),
        }
    }
    false
}

#[cfg(test)]
#[path = "recording_upload_tests.rs"]
mod tests;
