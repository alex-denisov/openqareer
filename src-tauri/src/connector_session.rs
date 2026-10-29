//! Native platform sign-in sessions for the desktop companion.
//!
//! The candidate signs in to LinkedIn or hh.ru **in the platform's own page**,
//! inside a window this application owns. `window.open` cannot do that here:
//! Tauri only installs a new-window handler for webviews that declare one, and
//! the main window is declared in `tauri.conf.json`, so WKWebView/WebView2
//! silently refuse the request and no window ever appears (B149).

use crate::linkedin_read_guard::{is_detail_page, is_people_search_page, LinkedInReadGuardState};
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, remove_dir_all, symlink_metadata};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl,
    WebviewWindowBuilder,
};
use uuid::Uuid;

const PAGE_READY_TIMEOUT: Duration = Duration::from_secs(25);
const PAGE_POLL_INTERVAL: Duration = Duration::from_millis(350);
/// Single-page platforms keep painting after `readyState` flips to complete.
const PAGE_SETTLE_DELAY: Duration = Duration::from_millis(900);
/// hh.ru keeps the profile page at `interactive` for over a minute (a request
/// that never settles), while the resume list is already in the server-rendered
/// DOM after ~2 s. Waiting for `complete` timed out every read (23.10.2026).
const HH_INTERACTIVE_GRACE: Duration = Duration::from_secs(3);
const EVAL_TIMEOUT: Duration = Duration::from_secs(15);
const HH_SIGNED_IN_SELECTOR: &str = r#"[data-qa^="mainmenu_applicantProfile"], [data-qa^="mainmenu_profileAndResumes"], [data-qa^="profile-activator"]"#;
/// Shared with the live hh.ru evidence gate, so a drifted recogniser cannot
/// pass in Chromium while failing in the desktop webview (B157).
const INSPECTION_SCRIPT: &str = include_str!("connector_inspection.js");
const PLATFORM_PLACEHOLDER: &str = "__OPENQAREER_PLATFORM__";
const HH_MARKER_PLACEHOLDER: &str = "__OPENQAREER_HH_MARKER__";
/// Full provider DOM must never cross IPC without a hard upper bound.
const MAX_SESSION_PAGE_BODY_CHARS: usize = 2_000_000;
/// LinkedIn keeps the UI language in `_locale`; a URL query alone loses to an
/// existing German cookie after the first challenge redirect. Set both the
/// host-only and parent-domain forms before LinkedIn's own scripts run. The
/// script is scoped to LinkedIn by the browser's cookie rules and is harmless
/// in the challenge's Google/Protechs frames.
const LINKEDIN_LOCALE_INITIALIZATION_SCRIPT: &str = r#"
(function () {
  try {
    document.cookie = '_locale=en_US; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
    document.cookie = '_locale=en_US; Domain=.linkedin.com; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
  } catch (_) {}
})();
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWindowRequest {
    pub platform: String,
    pub url: String,
    pub layout: Option<SessionLayout>,
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionWindowReport {
    pub opened: bool,
    pub label: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPageReport {
    pub ok: bool,
    pub url: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInspectionReport {
    pub ready: bool,
    pub url: String,
    pub signed_in_applicant: bool,
    pub account_marker: Option<String>,
    pub login: bool,
    pub otp: bool,
    pub captcha: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolSessionCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    /// Unix seconds, matching the browser cookie's absolute expiry.
    pub expires_at: Option<i64>,
    pub http_only: bool,
    pub secure: bool,
    pub same_site: Option<String>,
}

/// One long-lived window per platform, so a second click focuses the window the
/// candidate already signed in to instead of starting a fresh session.
pub fn session_window_label(platform: &str) -> Option<&'static str> {
    match platform {
        "linkedin" => Some("connector-linkedin"),
        "hh" => Some("connector-hh"),
        _ => None,
    }
}

const MANAGED_LINKEDIN_LABEL_PREFIX: &str = "connector-linkedin-pool-";

/// Mockup 12 (B464): every sign-in window — candidate or pool — is a native
/// macOS window with its frame, close/minimise/full-screen controls and a Dock
/// entry; nothing of ours is drawn around the platform's page.
fn session_window_chrome(_managed: bool) -> (bool, bool, bool) {
    (true, true, false)
}

/// Parenting a decorated WebView on macOS can keep it from showing at all, so
/// sign-in windows stay top-level (B464).
fn should_parent_session_window(_session_key: Option<&str>) -> bool {
    false
}

fn managed_session_uuid(session_key: &str) -> Result<Uuid, String> {
    let raw = session_key
        .strip_prefix("profile_")
        .ok_or_else(|| "managed_session_key_invalid".to_string())?;
    Uuid::parse_str(raw).map_err(|_| "managed_session_key_invalid".to_string())
}

fn session_window_label_for(
    platform: &str,
    session_key: Option<&str>,
) -> Result<(String, Option<[u8; 16]>), String> {
    if let Some(key) = session_key {
        if platform != "linkedin" {
            return Err("managed_session_platform_unsupported".to_string());
        }
        let uuid = managed_session_uuid(key)?;
        return Ok((
            format!("{MANAGED_LINKEDIN_LABEL_PREFIX}{}", uuid.simple()),
            Some(*uuid.as_bytes()),
        ));
    }
    Ok((
        session_window_label(platform)
            .ok_or_else(|| "unsupported_platform".to_string())?
            .to_string(),
        None,
    ))
}

fn host_belongs_to(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

fn is_linkedin_cookie_domain(domain: &str) -> bool {
    let raw = domain.trim().to_ascii_lowercase();
    if raw.starts_with("..") {
        return false;
    }
    let normalized = raw.strip_prefix('.').unwrap_or(&raw);
    normalized == "linkedin.com"
        || normalized.ends_with(".linkedin.com")
        || normalized == "linkedin.cn"
        || normalized.ends_with(".linkedin.cn")
}

/// RFC 6265 token characters; the server accepts nothing else (serverSessionCookies.ts).
fn is_cookie_name_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(character)
}

/// Returns only the LinkedIn cookies from the isolated managed pool profile.
/// The value crosses Tauri IPC only for the explicit server-save action.
pub fn read_linkedin_pool_session_cookies(
    app: &AppHandle,
    session_key: &str,
) -> Result<Vec<PoolSessionCookie>, String> {
    let (label, _) = session_window_label_for("linkedin", Some(session_key))?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "managed_session_window_missing".to_string())?;
    let linkedin_url = Url::parse("https://www.linkedin.com/")
        .map_err(|_| "linkedin_cookie_origin_invalid".to_string())?;
    let cookies = webview
        .cookies_for_url(linkedin_url)
        .map_err(|_| "linkedin_session_cookie_read_failed".to_string())?;
    let mut exported = Vec::new();
    for cookie in cookies {
        // `cookies_for_url` limits host-only cookies to this LinkedIn origin;
        // preserve that scope in the wire contract as `www.linkedin.com`.
        let domain = cookie.domain().unwrap_or("www.linkedin.com");
        if !is_linkedin_cookie_domain(domain) {
            continue;
        }
        let name = cookie.name();
        let value = cookie.value();
        let path = cookie.path().unwrap_or("/");
        if name.is_empty()
            || name.len() > 256
            || value.is_empty()
            || value.len() > 8_192
            || value
                .chars()
                .any(|character| character.is_control() || character == ';')
            || path.len() > 1_024
            || !path.starts_with('/')
            || !name.chars().all(is_cookie_name_character)
            || (cookie.same_site() == Some(tauri::webview::cookie::SameSite::None)
                && !cookie.secure().unwrap_or(false))
        {
            // LinkedIn keeps a few cleared (empty) or oddly shaped cookies in a
            // live profile; one of them must not sink the whole transfer (B325).
            // The session itself is `li_at`, checked below.
            continue;
        }
        exported.push(PoolSessionCookie {
            name: name.to_string(),
            value: value.to_string(),
            domain: domain.to_string(),
            path: path.to_string(),
            expires_at: cookie
                .expires_datetime()
                .map(|expires| expires.unix_timestamp()),
            http_only: cookie.http_only().unwrap_or(false),
            secure: cookie.secure().unwrap_or(false),
            same_site: cookie.same_site().map(|same_site| same_site.to_string()),
        });
    }
    if exported.len() > 100 {
        return Err("linkedin_session_cookie_count_invalid".to_string());
    }
    if !exported
        .iter()
        .any(|cookie| cookie.name == "li_at" && !cookie.value.is_empty())
    {
        return Err("linkedin_session_cookie_required".to_string());
    }
    Ok(exported)
}

/// The session window is ours: it may only ever hold the platform the candidate
/// asked for. A crafted URL must not turn it into a general-purpose browser.
pub fn is_allowed_session_url(platform: &str, url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port_or_known_default() != Some(443)
    {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    match platform {
        "linkedin" => host_belongs_to(host, "linkedin.com") || host_belongs_to(host, "linkedin.cn"),
        "hh" => host_belongs_to(host, "hh.ru") || host_belongs_to(host, "headhunter.ru"),
        _ => false,
    }
}

/// WebKit asks the navigation delegate about child-frame bootstrap documents
/// as well as top-level provider pages. Rejecting `about:blank` prevents a
/// platform-owned CAPTCHA iframe from constructing its document and leaves the
/// candidate on a permanently blank security check. Entry URLs stay governed
/// by the stricter `is_allowed_session_url` boundary above.
pub fn is_allowed_session_navigation_url(platform: &str, url: &str) -> bool {
    if url == "about:blank" || is_allowed_session_url(platform, url) {
        return true;
    }
    if platform == "hh" {
        let Ok(parsed) = Url::parse(url) else {
            return false;
        };
        if parsed.scheme() != "https" {
            return false;
        }
        if let Some(host) = parsed.host_str() {
            if host == "mc.yandex.ru"
                || host_belongs_to(host, "yandex.ru")
                || host_belongs_to(host, "yastatic.net")
                || host_belongs_to(host, "yandexcloud.net")
            {
                return true;
            }
        }
        return false;
    }
    if platform != "linkedin" {
        return false;
    }
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    matches!(
        parsed.host_str().map(str::to_ascii_lowercase).as_deref(),
        Some("accounts.google.com")
            | Some("www.google.com")
            | Some("www.recaptcha.net")
            | Some("www.gstatic.com")
            | Some("li.protechts.net")
    )
}

fn allow_session_navigation(platform: &str, url: &Url) -> bool {
    let allowed = is_allowed_session_navigation_url(platform, url.as_str());
    if !allowed {
        // Host and scheme are enough to maintain the allowlist. Never log the
        // path, query or fragment: challenge URLs may carry account-bound data.
        eprintln!(
            "connector_navigation_rejected platform={platform} scheme={} host={}",
            url.scheme(),
            url.host_str().unwrap_or("-")
        );
    }
    allowed
}

/// LinkedIn is unreachable from some routes, but a proxy that nothing listens on
/// is worse than no proxy: every request fails at connect time (B149 §4).
pub fn should_route_through_tunnel(url: &str, tunnel_running: bool) -> bool {
    if !tunnel_running {
        return false;
    }
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    host_belongs_to(host, "linkedin.com")
        || host_belongs_to(host, "licdn.com")
        || host_belongs_to(host, "lnkd.in")
        || host_belongs_to(host, "linkedin.cn")
        || matches!(
            host,
            "accounts.google.com"
                | "www.google.com"
                | "www.recaptcha.net"
                | "www.gstatic.com"
                | "li.protechts.net"
        )
}

fn validate(request: &SessionWindowRequest) -> Result<(String, Url, Option<[u8; 16]>), String> {
    let (label, data_store_identifier) =
        session_window_label_for(&request.platform, request.session_key.as_deref())?;
    if !is_allowed_session_url(&request.platform, &request.url) {
        return Err("url_not_allowed".to_string());
    }
    let url = Url::parse(&request.url).map_err(|_| "url_not_allowed".to_string())?;
    Ok((label, url, data_store_identifier))
}

fn managed_data_directory(app: &AppHandle, session_key: &str) -> Result<PathBuf, String> {
    if !managed_linkedin_store_available() {
        return Err("managed_session_store_requires_macos_14".to_string());
    }
    let uuid = managed_session_uuid(session_key)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("managed_session_data_dir_unavailable: {error}"))?
        .join("linkedin-pool");
    let directory = root.join(format!("profile_{}", uuid.simple()));
    create_private_directory(&root)?;
    create_private_directory(&directory)?;
    Ok(directory)
}

fn managed_data_directory_path(app: &AppHandle, session_key: &str) -> Result<PathBuf, String> {
    let uuid = managed_session_uuid(session_key)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("managed_session_data_dir_unavailable: {error}"))?
        .join("linkedin-pool")
        .join(format!("profile_{}", uuid.simple())))
}

fn managed_linkedin_store_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
        supports_custom_store_on_macos(version.majorVersion)
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn supports_custom_store_on_macos(major_version: isize) -> bool {
    major_version >= 14
}

fn can_clear_managed_profile(
    store_isolation_available: bool,
    profile_exists: bool,
    window_open: bool,
) -> bool {
    store_isolation_available || (!profile_exists && !window_open)
}

fn create_private_directory(path: &std::path::Path) -> Result<(), String> {
    create_dir_all(path)
        .map_err(|error| format!("managed_session_data_dir_create_failed: {error}"))?;
    let metadata = symlink_metadata(path)
        .map_err(|error| format!("managed_session_data_dir_unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("managed_session_data_dir_invalid".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("managed_session_data_dir_permissions_failed: {error}"))?;
    }
    Ok(())
}

/// Closes the account's WebView, removes its WebKit data store and its local
/// profile after transfer or revocation. Any failure is returned to the admin
/// UI so it cannot report that the device copy was erased.
pub async fn clear_linkedin_pool_profile(app: &AppHandle, session_key: &str) -> Result<(), String> {
    let (label, data_store_identifier) = session_window_label_for("linkedin", Some(session_key))?;
    let directory = managed_data_directory_path(app, session_key)?;
    let parent = directory
        .parent()
        .ok_or_else(|| "managed_session_profile_path_invalid".to_string())?;
    match symlink_metadata(parent) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("managed_session_profile_path_invalid".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("managed_session_profile_clear_failed: {error}")),
    }
    let profile_exists = match symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("managed_session_profile_path_invalid".to_string());
        }
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("managed_session_profile_clear_failed: {error}")),
    };
    let store_isolation_available = managed_linkedin_store_available();
    let window_open = app.get_webview(&label).is_some();
    if !can_clear_managed_profile(store_isolation_available, profile_exists, window_open) {
        return Err("managed_session_store_requires_macos_14".to_string());
    }
    if !store_isolation_available {
        return Ok(());
    }
    if window_open && !close_session_window_by_label(app, &label) {
        return Err("managed_session_window_close_failed".to_string());
    }
    if !await_managed_window_closed(app, &label).await {
        return Err("managed_session_window_close_failed".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let identifier = data_store_identifier
            .ok_or_else(|| "managed_session_store_identifier_missing".to_string())?;
        let data_stores = app
            .fetch_data_store_identifiers()
            .await
            .map_err(|_| "managed_session_data_store_read_failed".to_string())?;
        if data_stores.contains(&identifier) {
            app.remove_data_store(identifier)
                .await
                .map_err(|_| "managed_session_data_store_remove_failed".to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = data_store_identifier;
    if directory.exists() {
        remove_dir_all(&directory)
            .map_err(|error| format!("managed_session_profile_clear_failed: {error}"))?;
    }
    if directory.exists() {
        return Err("managed_session_profile_clear_failed".to_string());
    }
    Ok(())
}

async fn await_managed_window_closed(app: &AppHandle, label: &str) -> bool {
    for _ in 0..20 {
        if app.get_webview(label).is_none() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    app.get_webview(label).is_none()
}

/// The OpenQareer account the candidate sign-in windows belong to. Every
/// account gets its own WebView store: the default store is shared by the whole
/// app, so a second account on the same Mac saw the first one's LinkedIn
/// session (INC-039).
#[derive(Default)]
pub struct CandidateSessionAccount(Mutex<Option<String>>);

const CANDIDATE_ACCOUNT_KEY_LENGTH: usize = 64;

fn is_valid_account_key(key: &str) -> bool {
    key.len() == CANDIDATE_ACCOUNT_KEY_LENGTH
        && key
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn account_store_identifier(key: &str) -> Result<[u8; 16], String> {
    let mut identifier = [0u8; 16];
    for (index, slot) in identifier.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&key[index * 2..index * 2 + 2], 16)
            .map_err(|_| "account_key_invalid".to_string())?;
    }
    Ok(identifier)
}

fn candidate_data_directory(app_data_dir: &Path, account_key: &str) -> Result<PathBuf, String> {
    if !is_valid_account_key(account_key) {
        return Err("account_key_invalid".to_string());
    }
    let root = app_data_dir.join("candidate-sessions");
    create_private_directory(&root)
        .map_err(|_| "candidate_session_data_dir_create_failed".to_string())?;
    let directory = root.join(&account_key[..32]);
    create_private_directory(&directory)
        .map_err(|_| "candidate_session_data_dir_create_failed".to_string())?;
    Ok(directory)
}

/// Binds candidate sessions to an account. A change of account closes the
/// previous account's windows so none of them outlives the sign-out.
pub fn bind_candidate_account(app: &AppHandle, key: Option<String>) -> Result<bool, String> {
    if key
        .as_deref()
        .is_some_and(|value| !is_valid_account_key(value))
    {
        return Err("account_key_invalid".to_string());
    }
    let state = app.state::<CandidateSessionAccount>();
    let mut current = state
        .0
        .lock()
        .map_err(|_| "account_state_unavailable".to_string())?;
    if *current != key {
        close_session_window(app, "linkedin");
        close_session_window(app, "hh");
        *current = key;
    }
    Ok(current.is_some())
}

fn candidate_store(app: &AppHandle) -> Result<(PathBuf, [u8; 16]), String> {
    let key = app
        .state::<CandidateSessionAccount>()
        .0
        .lock()
        .map_err(|_| "account_state_unavailable".to_string())?
        .clone()
        .ok_or_else(|| "account_not_bound".to_string())?;
    let identifier = account_store_identifier(&key)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "candidate_session_data_dir_unavailable".to_string())?;
    let directory = candidate_data_directory(&app_data_dir, &key)?;
    Ok((directory, identifier))
}

/// WebView2 refuses a second window on a data folder that is already open with
/// other browser arguments, and only LinkedIn goes through the tunnel proxy. So
/// on Windows each platform keeps its own folder inside the account's (B576);
/// WebKit separates stores by identifier and keeps the shared folder.
fn platform_data_directory(directory: PathBuf, platform: &str) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let directory = directory.join(platform);
        create_private_directory(&directory)
            .map_err(|_| "candidate_session_data_dir_create_failed".to_string())?;
        Ok(directory)
    }
    #[cfg(not(windows))]
    {
        let _ = platform;
        Ok(directory)
    }
}

/// How long a freshly built window may take to appear in the manager before the
/// report stops calling it opened. The window is created on the main thread
/// while this command runs on a worker, so "build returned Ok" is not yet
/// "there is a window the session poller can inspect" (B157).
const WINDOW_REGISTRATION_TIMEOUT: Duration = Duration::from_secs(5);
const WINDOW_REGISTRATION_POLL: Duration = Duration::from_millis(100);

/// Waits for the built window to become inspectable, or gives up honestly.
async fn await_registered_window(app: &AppHandle, label: &str) -> bool {
    let deadline = tokio::time::Instant::now() + WINDOW_REGISTRATION_TIMEOUT;
    loop {
        if app.get_webview(label).is_some() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(WINDOW_REGISTRATION_POLL).await;
    }
}

/// Opens (or refocuses) the platform's own sign-in window.
pub async fn open_session_window(
    app: &AppHandle,
    request: &SessionWindowRequest,
    proxy_url: Option<Url>,
) -> SessionWindowReport {
    let (label, url, data_store_identifier) = match validate(request) {
        Ok(value) => value,
        Err(reason) => {
            return SessionWindowReport {
                opened: false,
                label: session_window_label(&request.platform)
                    .unwrap_or_default()
                    .to_string(),
                reason: Some(reason),
            }
        }
    };

    // A window that drifted elsewhere during a previous attempt must come back
    // to the page the candidate just asked for, not merely to the front.
    let layout = request.layout.clone().unwrap_or_else(|| {
        if request.session_key.is_some() {
            SessionLayout {
                x: 32.0,
                y: 70.0,
                width: 1156.0,
                height: 640.0,
            }
        } else {
            SessionLayout {
                x: 180.0,
                y: 140.0,
                width: 920.0,
                height: 620.0,
            }
        }
    });
    if layout.width < 320.0 || layout.height < 320.0 || layout.x < 0.0 || layout.y < 0.0 {
        return SessionWindowReport {
            opened: false,
            label: label.to_string(),
            reason: Some("session_layout_invalid".to_string()),
        };
    }

    // A search page loads only through `read_session_page`, which spends the
    // search budget; opening or moving the window onto one would not (B561).
    if search_page_entry_refused(&request.platform, url.path()) {
        return SessionWindowReport {
            opened: false,
            label: label.to_string(),
            reason: Some("search_page_needs_read".to_string()),
        };
    }

    if let Some(existing) = app.get_webview(&label) {
        if !existing.url().is_ok_and(|current| current == url) {
            if request.platform == "linkedin" && request.session_key.is_none() {
                tokio::time::sleep(pace_linkedin_navigation(app)).await;
            }
            let _ = existing.navigate(url);
        }
        resize_session_window_for(
            app,
            &request.platform,
            request.session_key.as_deref(),
            layout.clone(),
        );
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let _ = existing.show();
            let _ = existing.set_focus();
        }
        return SessionWindowReport {
            opened: true,
            label: label.to_string(),
            reason: None,
        };
    }

    let Some(main_window) = app.get_webview_window("main") else {
        return SessionWindowReport {
            opened: false,
            label: label.to_string(),
            reason: Some("main_window_missing".to_string()),
        };
    };
    let screen_layout = screen_layout(&layout, &main_window);
    let _ = append_connector_diagnostic(
        app,
        "session-window",
        "open",
        Some(&format!(
            "cy{}_sy{}_in{}_out{}_sc{}_tb{}",
            layout.y as i64,
            screen_layout.y as i64,
            main_window.inner_position().map(|p| p.y).unwrap_or(-1),
            main_window.outer_position().map(|p| p.y).unwrap_or(-1),
            (main_window.scale_factor().unwrap_or(0.0) * 10.0) as i64,
            native_title_bar(&main_window)
                .map(|bar| bar as i64)
                .unwrap_or(-1)
        )),
    );
    let platform = request.platform.clone();
    let mut builder = WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::External(url))
        .title(format!("OpenQareer · {}", platform_name(&request.platform)))
        .position(screen_layout.x, screen_layout.y)
        .inner_size(screen_layout.width, screen_layout.height)
        .on_navigation(move |next_url| allow_session_navigation(&platform, next_url));
    let (decorations, resizable, skip_taskbar) =
        session_window_chrome(request.session_key.is_some());
    builder = builder
        .decorations(decorations)
        .resizable(resizable)
        .skip_taskbar(skip_taskbar);

    if request.platform == "linkedin" {
        builder =
            builder.initialization_script_for_all_frames(LINKEDIN_LOCALE_INITIALIZATION_SCRIPT);
    }

    if let Some(session_key) = request.session_key.as_deref() {
        let data_directory = match managed_data_directory(app, session_key) {
            Ok(directory) => directory,
            Err(reason) => {
                return SessionWindowReport {
                    opened: false,
                    label,
                    reason: Some(reason),
                }
            }
        };
        builder = builder.data_directory(data_directory);
        if let Some(identifier) = data_store_identifier {
            builder = builder.data_store_identifier(identifier);
        }
    } else {
        let store = candidate_store(app).and_then(|(directory, identifier)| {
            Ok((
                platform_data_directory(directory, &request.platform)?,
                identifier,
            ))
        });
        let (data_directory, identifier) = match store {
            Ok(store) => store,
            Err(reason) => {
                return SessionWindowReport {
                    opened: false,
                    label,
                    reason: Some(reason),
                }
            }
        };
        builder = builder
            .data_directory(data_directory)
            .data_store_identifier(identifier);
    }

    // Sign-in windows are standalone native windows (mockup 12); parenting a
    // decorated WebView on macOS can prevent it from being shown at all.
    if should_parent_session_window(request.session_key.as_deref()) {
        builder = match builder.parent(&main_window) {
            Ok(parented) => parented,
            Err(error) => {
                return SessionWindowReport {
                    opened: false,
                    label: label.to_string(),
                    reason: Some(format!("window_parent_failed: {error}")),
                }
            }
        };
    }

    if let Some(proxy) = proxy_url {
        builder = builder.proxy_url(proxy);
    }

    match builder.build() {
        Ok(_) => {
            // Reporting "opened" before the window is inspectable is what threw
            // the whole step back to idle on the very first poll (B157).
            if request.session_key.is_none() {
                tauri::async_runtime::spawn(show_load_failure_if_blank(
                    app.clone(),
                    label.clone(),
                    if request.platform == "linkedin" {
                        "linkedin.com"
                    } else {
                        "hh.ru"
                    },
                    request.url.clone(),
                ));
            }
            if await_registered_window(app, &label).await {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = append_connector_diagnostic(
                        app,
                        "session-window",
                        "placed",
                        Some(&format!(
                            "out{}_in{}",
                            window.outer_position().map(|p| p.y).unwrap_or(-1),
                            window.inner_position().map(|p| p.y).unwrap_or(-1)
                        )),
                    );
                }
                SessionWindowReport {
                    opened: true,
                    label: label.to_string(),
                    reason: None,
                }
            } else {
                SessionWindowReport {
                    opened: false,
                    label: label.to_string(),
                    reason: Some("window_not_registered".to_string()),
                }
            }
        }
        Err(error) => SessionWindowReport {
            opened: false,
            label: label.to_string(),
            reason: Some(format!("window_build_failed: {error}")),
        },
    }
}

/// Whether the candidate still has the platform's window on screen. The desktop
/// shell has no `opener` relationship to poll, so the window itself is the
/// signal that an external sign-in flow is still running.
pub fn is_session_window_open(app: &AppHandle, platform: &str) -> bool {
    session_window_label(platform)
        .and_then(|label| app.get_webview(label))
        .is_some()
}

/// Brings the existing candidate window forward without changing its URL.
pub fn show_session_window(app: &AppHandle, platform: &str) -> bool {
    let Some(label) = session_window_label(platform) else {
        return false;
    };
    let Some(window) = app.get_webview_window(label) else {
        return false;
    };
    window.show().and_then(|()| window.set_focus()).is_ok()
}

pub fn is_managed_session_window_open(
    app: &AppHandle,
    platform: &str,
    session_key: Option<&str>,
) -> bool {
    let Ok((label, _)) = session_window_label_for(platform, session_key) else {
        return false;
    };
    app.get_webview(&label).is_some()
}

/// The application's own webview. Everything else with a label is a session
/// window this module opened.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Which sign-in windows a page load in `webview_label` has just orphaned.
///
/// Reloading the application's own page — the WebKit context menu offers
/// «Reload» on any blank area — destroys the React tree that owned the sign-in
/// window. The window itself is a native child window and survives, now with
/// nothing left that can close it: the owner had to quit the whole application
/// to get rid of it (owner report, 2026-08-26).
///
/// A page load **inside** a session window is the candidate signing in, which
/// is the entire point of that window; it orphans nothing.
pub fn sessions_orphaned_by_page_load(webview_label: &str) -> &'static [&'static str] {
    if webview_label == MAIN_WINDOW_LABEL {
        &["linkedin", "hh"]
    } else {
        &[]
    }
}

/// Closes every sign-in window a page load in `webview_label` has orphaned.
pub fn close_orphaned_session_windows(app: &AppHandle, webview_label: &str) {
    for platform in sessions_orphaned_by_page_load(webview_label) {
        close_session_window(app, platform);
    }
    if webview_label == MAIN_WINDOW_LABEL {
        let managed_labels: Vec<String> = app
            .webview_windows()
            .keys()
            .filter(|label| label.starts_with(MANAGED_LINKEDIN_LABEL_PREFIX))
            .cloned()
            .collect();
        for label in managed_labels {
            close_session_window_by_label(app, &label);
        }
    }
}

pub fn close_session_window(app: &AppHandle, platform: &str) -> bool {
    session_window_label(platform).is_some_and(|label| close_session_window_by_label(app, label))
}

pub fn close_managed_session_window(
    app: &AppHandle,
    platform: &str,
    session_key: Option<&str>,
) -> bool {
    let Ok((label, _)) = session_window_label_for(platform, session_key) else {
        return false;
    };
    close_session_window_by_label(app, &label)
}

fn close_session_window_by_label(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .is_some_and(|window| window.close().is_ok())
        || app
            .get_webview(label)
            .is_some_and(|webview| webview.close().is_ok())
}

/// The page a reset-only window loads. Nothing is ever read from it: it exists
/// solely to give us a webview handle on the platform's browsing data.
pub fn platform_root_url(platform: &str) -> Option<&'static str> {
    match platform {
        "linkedin" => Some("https://www.linkedin.com/"),
        "hh" => Some("https://hh.ru/"),
        _ => None,
    }
}

/// Clears the candidate's sign-in to a platform, with or without its window on
/// screen.
///
/// The sign-out used to live in the session dialog's toolbar, where a window
/// was open by definition. The owner moved it onto the platform card, where
/// there is usually no window at all — and a reset that gave up in that case
/// released the account's connection while leaving the candidate still signed
/// in to the platform inside the app (owner report, 2026-08-26). So the reset
/// builds a hidden window purely to reach the browsing data, then closes it.
pub async fn reset_session_window(app: &AppHandle, platform: &str) -> bool {
    let Some(label) = session_window_label(platform) else {
        return false;
    };
    if app.get_webview(label).is_none() && !open_hidden_session_window(app, platform, label).await {
        return false;
    }
    let Some(webview) = app.get_webview(label) else {
        return false;
    };
    if webview.clear_all_browsing_data().is_err() {
        return false;
    }
    let cookies_gone = await_empty_cookie_store(&webview).await;
    close_session_window(app, platform) && cookies_gone
}

const COOKIE_CLEAR_CHECKS: u32 = 10;
const COOKIE_CLEAR_CHECK_INTERVAL: Duration = Duration::from_millis(300);

/// `clear_all_browsing_data` only starts an asynchronous removal and never
/// reports its end, so a disconnect used to close the window 500 ms later
/// with the platform cookies still in place (B266: the next «Подключить»
/// signed in silently). This waits until the store is really empty, deleting
/// any cookie that survived, and reports failure instead of assuming success.
async fn await_empty_cookie_store<R: tauri::Runtime>(webview: &tauri::Webview<R>) -> bool {
    for _ in 0..COOKIE_CLEAR_CHECKS {
        tokio::time::sleep(COOKIE_CLEAR_CHECK_INTERVAL).await;
        let Ok(remaining) = webview.cookies() else {
            return false;
        };
        if remaining.is_empty() {
            return true;
        }
        for cookie in remaining {
            let _ = webview.delete_cookie(cookie);
        }
    }
    false
}

/// Builds an invisible session window, kept to the same origin allow-list as
/// the visible one.
async fn open_hidden_session_window(app: &AppHandle, platform: &str, label: &str) -> bool {
    let Some(url) = platform_root_url(platform).and_then(|raw| Url::parse(raw).ok()) else {
        return false;
    };
    let Ok((data_directory, identifier)) =
        candidate_store(app).and_then(|(directory, identifier)| {
            Ok((platform_data_directory(directory, platform)?, identifier))
        })
    else {
        return false;
    };
    let allowed = platform.to_string();
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(format!("OpenQareer · {}", platform_name(platform)))
        .data_directory(data_directory)
        .data_store_identifier(identifier)
        .inner_size(480.0, 360.0)
        .visible(false)
        .skip_taskbar(true)
        .on_navigation(move |next| allow_session_navigation(&allowed, next));
    if platform == "linkedin" {
        builder =
            builder.initialization_script_for_all_frames(LINKEDIN_LOCALE_INITIALIZATION_SCRIPT);
    }
    let built = builder.build();
    built.is_ok() && await_registered_window(app, label).await
}

pub fn resize_session_window(app: &AppHandle, platform: &str, layout: SessionLayout) -> bool {
    resize_session_window_for(app, platform, None, layout)
}

pub fn resize_session_window_for(
    app: &AppHandle,
    platform: &str,
    session_key: Option<&str>,
    layout: SessionLayout,
) -> bool {
    if layout.width < 320.0 || layout.height < 320.0 || layout.x < 0.0 || layout.y < 0.0 {
        return false;
    }
    session_window_label_for(platform, session_key)
        .ok()
        .map(|(label, _)| label)
        .is_some_and(|label| {
            if let Some(window) = app.get_webview_window(&label) {
                let Some(main) = app.get_webview_window("main") else {
                    return false;
                };
                let screen = screen_layout(&layout, &main);
                return window
                    .set_position(LogicalPosition::new(screen.x, screen.y))
                    .and_then(|_| window.set_size(LogicalSize::new(screen.width, screen.height)))
                    .is_ok();
            }
            app.get_webview(&label).is_some_and(|webview| {
                webview
                    .set_position(LogicalPosition::new(layout.x, layout.y))
                    .and_then(|_| webview.set_size(LogicalSize::new(layout.width, layout.height)))
                    .is_ok()
            })
        })
}

fn platform_name(platform: &str) -> &'static str {
    if platform == "linkedin" {
        "LinkedIn"
    } else {
        "hh.ru"
    }
}

/// A sign-in page that drew no text by then never opened (no network, no route).
const LOAD_FAILURE_AFTER: Duration = Duration::from_secs(20);
const DRAWN_PROBE: &str =
    "JSON.stringify(((document.body && document.body.innerText) || '').trim().length)";

/// The probe answers a text length, possibly JSON-quoted more than once.
fn page_has_text(value: &str) -> bool {
    value
        .trim_matches(|c: char| c == '"' || c == '\\' || c.is_whitespace())
        .parse::<usize>()
        .is_ok_and(|length| length > 0)
}

/// Mockup 12, «Страница не открылась»: drawn inside the window itself, with a
/// retry that reloads the platform's own address (allowed by the navigation list).
fn load_failure_script(host: &str, retry_url: &str) -> String {
    let url = serde_json::to_string(retry_url).unwrap_or_else(|_| "\"about:blank\"".into());
    let markup = format!(
        "<div style='min-height:100vh;display:grid;place-items:center;font:14px -apple-system,sans-serif;color:#1f2328;background:#fff'>\
         <div style='text-align:center;display:grid;gap:12px;justify-items:center'>\
         <div style='width:28px;height:28px;border:2px solid #b42318;border-radius:50%;color:#b42318;font-weight:700;line-height:26px'>!</div>\
         <strong style='font-size:16px'>Страница не открылась</strong>\
         <p style='margin:0'>Нет связи с {host}. Проверьте сеть и повторите.</p>\
         <button id='oq-retry' style='padding:8px 20px;border:1px solid #1f2328;border-radius:10px;background:#fff;font:inherit;cursor:pointer'>Повторить</button>\
         </div></div>"
    );
    format!(
        "document.documentElement.innerHTML = {};\
         document.getElementById('oq-retry').onclick = () => location.replace({url});",
        serde_json::to_string(&markup).unwrap_or_default()
    )
}

/// Shows the in-window failure when the platform page has drawn nothing by
/// `LOAD_FAILURE_AFTER` (B464, mockup 12).
async fn show_load_failure_if_blank(
    app: AppHandle,
    label: String,
    host: &'static str,
    retry_url: String,
) {
    tokio::time::sleep(LOAD_FAILURE_AFTER).await;
    let Some(webview) = app.get_webview(&label) else {
        return;
    };
    let drawn = eval_json(&webview, DRAWN_PROBE)
        .await
        .is_ok_and(|value| page_has_text(&value));
    if !drawn {
        let _ = webview.eval(load_failure_script(host, &retry_url));
    }
}

/// Logical title-bar height above the page. On macOS tao reports the frame as
/// the content origin (23.10: inner == outer, 0 pt), which placed the window
/// 28 pt too high (B464); the NSWindow's own layout rect fills in.
/// Implausible values (over 100 pt) are ignored.
fn title_bar_offset(outer_height: u32, inner_height: u32, scale: f64, native: Option<f64>) -> f64 {
    let reported = f64::from(outer_height.saturating_sub(inner_height)) / scale;
    if reported > 0.0 {
        return reported;
    }
    native
        .filter(|top| (0.0..=100.0).contains(top))
        .unwrap_or(0.0)
}

/// Title bar read from the NSWindow: frame height minus the area the title bar
/// leaves uncovered. AppKit answers only on the main thread, so the read is
/// posted there and awaited briefly.
#[cfg(target_os = "macos")]
fn native_title_bar(main: &tauri::WebviewWindow) -> Option<f64> {
    fn read(window: &tauri::WebviewWindow) -> Option<f64> {
        objc2::MainThreadMarker::new()?;
        let pointer = window.ns_window().ok()?.cast::<objc2_app_kit::NSWindow>();
        // SAFETY: Tauri hands out the live NSWindow of this window; only geometry is read.
        let ns_window = unsafe { pointer.as_ref() }?;
        Some(ns_window.frame().size.height - ns_window.contentLayoutRect().size.height)
    }
    if objc2::MainThreadMarker::new().is_some() {
        return read(main);
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    let window = main.clone();
    main.run_on_main_thread(move || {
        let _ = sender.send(read(&window));
    })
    .ok()?;
    receiver
        .recv_timeout(Duration::from_millis(300))
        .ok()
        .flatten()
}

#[cfg(not(target_os = "macos"))]
fn native_title_bar(_main: &tauri::WebviewWindow) -> Option<f64> {
    None
}

fn screen_layout(layout: &SessionLayout, main: &tauri::WebviewWindow) -> SessionLayout {
    let scale = main.scale_factor().unwrap_or(1.0);
    let origin = main.inner_position().unwrap_or_default();
    let outer = main.outer_position().unwrap_or_default();
    let title_bar = if origin == outer {
        let outer_height = main
            .outer_size()
            .map(|size| size.height)
            .unwrap_or_default();
        let inner_height = main
            .inner_size()
            .map(|size| size.height)
            .unwrap_or(outer_height);
        title_bar_offset(outer_height, inner_height, scale, native_title_bar(main))
    } else {
        0.0
    };
    SessionLayout {
        x: f64::from(origin.x) / scale + layout.x,
        y: f64::from(origin.y) / scale + title_bar + layout.y,
        width: layout.width,
        height: layout.height,
    }
}

#[derive(Deserialize)]
struct DocumentState {
    ready: String,
    href: String,
}

/// `eval_with_callback` hands the JSON-encoded result to a `Fn` callback; the
/// oneshot sender has to survive being borrowed, hence the mutex.
async fn eval_json(window: &Webview, js: &str) -> Result<String, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel::<String>();
    let slot = Mutex::new(Some(sender));
    window
        .eval_with_callback(js, move |value| {
            if let Ok(mut guard) = slot.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(value);
                }
            }
        })
        .map_err(|error| format!("eval_failed: {error}"))?;

    tokio::time::timeout(EVAL_TIMEOUT, receiver)
        .await
        .map_err(|_| "eval_timeout".to_string())?
        .map_err(|_| "eval_cancelled".to_string())
}

async fn read_document_state(window: &Webview) -> Result<DocumentState, String> {
    let raw = eval_json(
        window,
        "(function(){try{return {ready: document.readyState, href: location.href};}\
catch(e){return {ready: 'error', href: ''};}})()",
    )
    .await?;
    serde_json::from_str::<DocumentState>(&raw).map_err(|error| format!("eval_shape: {error}"))
}

/// LinkedIn fills sections after load, so it still waits for `complete`.
fn page_ready_to_read(platform: &str, ready: &str, interactive_for: Duration) -> bool {
    ready == "complete"
        || (platform == "hh" && ready == "interactive" && interactive_for >= HH_INTERACTIVE_GRACE)
}

fn validate_page_body(body: String) -> Result<String, String> {
    if body == "__OPENQAREER_PAGE_TOO_LARGE__" || body.chars().count() > MAX_SESSION_PAGE_BODY_CHARS
    {
        return Err("page_body_too_large".to_string());
    }
    Ok(body)
}

// LinkedIn-only attribute allowlist (B266, architecture.md §3). hh.ru keeps
// the original `data-qa`/`class`/resume-href rule untouched. These helpers
// are the tested source of truth for the constants the sanitize script below
// embeds; the per-node walk itself still has to run inside the page (no
// per-element IPC round trip), so the JS mirrors the same checks by hand.
/// Every profile anchor the extractor reads lives under this namespace: section
/// cards (`…profile.card.ref…`) and skill rows (`…profile.skill(…)`) (B266).
const LINKEDIN_ID_PREFIX: &str = "com.linkedin.sdui.profile.";
const LINKEDIN_COMPONENTKEY_MAX_CHARS: usize = 200;
const LINKEDIN_TESTID_MAX_CHARS: usize = 80;
const LINKEDIN_HREF_PATHS: &[&str] = &["/in/", "/company/", "/school/", "/details/", "/safety/go/"];
const LINKEDIN_MEDIA_SRC_PREFIX: &str = "https://media.licdn.com/dms/image/";
const LINKEDIN_SRCSET_TARGET_WIDTH: i64 = 400;

// These four are the tested Rust reference for the allowlist the JS in
// `page_sanitize_script` mirrors by hand (no per-node IPC round trip is
// possible while walking the cloned DOM inside the page). Not called from
// production code, only from the tests below.
#[allow(dead_code)]
fn linkedin_id_allowed(id: &str) -> bool {
    id.starts_with(LINKEDIN_ID_PREFIX)
}

/// `href` kept only for linkedin.com/*.linkedin.com hosts on the allowed
/// paths; the query string survives solely for `/safety/go/`, where the
/// destination lives in `?url=`.
#[allow(dead_code)]
fn linkedin_href_allowed(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    let host = url.host_str()?;
    if host != "linkedin.com" && !host.ends_with(".linkedin.com") {
        return None;
    }
    let path = url.path();
    if !LINKEDIN_HREF_PATHS
        .iter()
        .any(|prefix| path.starts_with(prefix))
    {
        return None;
    }
    if path.starts_with("/safety/go/") {
        match url.query() {
            Some(query) => Some(format!("{path}?{query}")),
            None => Some(path.to_string()),
        }
    } else {
        Some(path.to_string())
    }
}

#[allow(dead_code)]
fn linkedin_image_src_allowed(src: &str) -> bool {
    src.starts_with(LINKEDIN_MEDIA_SRC_PREFIX)
}

/// Picks the `srcset` candidate closest to 400px among the licdn variants;
/// non-licdn and `data:` candidates are dropped.
#[allow(dead_code)]
fn pick_linkedin_srcset_variant(srcset: &str) -> Option<String> {
    srcset
        .split(',')
        .filter_map(|entry| {
            let trimmed = entry.trim();
            let mut parts = trimmed.split_whitespace();
            let url = parts.next()?;
            if !linkedin_image_src_allowed(url) {
                return None;
            }
            let width: i64 = parts
                .next()
                .unwrap_or("")
                .trim_end_matches('w')
                .parse()
                .ok()?;
            Some((
                (width - LINKEDIN_SRCSET_TARGET_WIDTH).abs(),
                url.to_string(),
            ))
        })
        .min_by_key(|(diff, _)| *diff)
        .map(|(_, url)| url)
}

/// Builds the in-page sanitizer that turns a cloned DOM subtree into the
/// stripped-down HTML the extractor reads. hh.ru keeps the original
/// `data-qa`/`class`/resume-href rule; LinkedIn additionally keeps a small,
/// tested allowlist the extractor needs (id/componentkey/data-testid/
/// aria-hidden/href/img src+srcset) per architecture.md §3.
fn page_sanitize_script(platform: &str) -> String {
    let linkedin_read = if platform == "linkedin" {
        "const id=node.getAttribute('id');\
const componentkey=node.getAttribute('componentkey');\
const testid=node.getAttribute('data-testid');\
const ariaHidden=node.getAttribute('aria-hidden');\
const src=node.getAttribute('src');\
const srcset=node.getAttribute('srcset');"
            .to_string()
    } else {
        String::new()
    };
    let linkedin_apply = if platform == "linkedin" {
        format!(
            "if(id&&id.indexOf('{LINKEDIN_ID_PREFIX}')===0){{node.setAttribute('id',id);}}\
if(componentkey&&componentkey.length<={LINKEDIN_COMPONENTKEY_MAX_CHARS}){{node.setAttribute('componentkey',componentkey);}}\
if(testid&&testid.length<={LINKEDIN_TESTID_MAX_CHARS}){{node.setAttribute('data-testid',testid);}}\
if(ariaHidden!==null){{node.setAttribute('aria-hidden',ariaHidden);}}\
if(node.tagName==='IMG'){{\
if(src&&src.indexOf('{LINKEDIN_MEDIA_SRC_PREFIX}')===0){{node.setAttribute('src',src);}}\
if(srcset){{\
var best=null,bestDiff=Infinity;\
srcset.split(',').forEach(function(entry){{\
var bits=entry.trim().split(/\\s+/);\
var u=bits[0];var w=parseInt((bits[1]||'').replace('w',''),10);\
if(u&&u.indexOf('{LINKEDIN_MEDIA_SRC_PREFIX}')===0&&!isNaN(w)){{\
var diff=Math.abs(w-{LINKEDIN_SRCSET_TARGET_WIDTH});\
if(diff<bestDiff){{bestDiff=diff;best=u;}}\
}}\
}});\
if(best){{node.setAttribute('srcset',best);}}\
}}\
}}\
",
        )
    } else {
        String::new()
    };
    let href_rule = if platform == "linkedin" {
        format!(
            "if(href){{try{{\
const parsed=new URL(href,location.origin);\
const hostOk=parsed.hostname==='linkedin.com'||parsed.hostname.endsWith('.linkedin.com');\
const paths={linkedin_paths};\
const pathOk=paths.some(function(p){{return parsed.pathname.indexOf(p)===0;}});\
if(hostOk&&pathOk){{\
const keepQuery=parsed.pathname.indexOf('/safety/go/')===0;\
node.setAttribute('href',keepQuery?parsed.pathname+parsed.search:parsed.pathname);\
}}\
}}catch(e){{}}}}",
            linkedin_paths = serde_json::to_string(LINKEDIN_HREF_PATHS).unwrap_or_default(),
        )
    } else {
        "if(href){try{const parsed=new URL(href,location.origin);\
if(/^\\/resume\\/[A-Za-z0-9_-]+$/u.test(parsed.pathname)){node.setAttribute('href',parsed.pathname);}\
}catch(e){}}"
            .to_string()
    };
    format!(
        "(function(){{try{{\
const visibleText=function(node){{return (typeof node.innerText==='string'?node.innerText:node.textContent||'').trim().length;}};\
const overlay=location.pathname.indexOf('/overlay/')>=0?Array.from(document.querySelectorAll('[role=dialog],dialog')).reduce(function(best,node){{return !best||visibleText(node)>visibleText(best)?node:best;}},null):null;\
const source=(overlay&&visibleText(overlay)>0&&overlay)||document.querySelector('main')||document.body||document.documentElement;\
const root=source.cloneNode(true);\
root.querySelectorAll('script,style,noscript,iframe,object,embed,input,textarea,select,meta,link').forEach(function(node){{node.remove();}});\
root.querySelectorAll('*').forEach(function(node){{\
const qa=node.getAttribute('data-qa');\
const className=node.getAttribute('class');\
const href=node.getAttribute('href');\
{linkedin_read}\
Array.from(node.attributes).forEach(function(attribute){{node.removeAttribute(attribute.name);}});\
{linkedin_apply}\
if(qa&&qa.length<=160){{node.setAttribute('data-qa',qa);}}\
if(className&&className.length<=500){{node.setAttribute('class',className);}}\
{href_rule}\
}});\
const body=root.outerHTML;\
return body.length>{MAX_SESSION_PAGE_BODY_CHARS}?'__OPENQAREER_PAGE_TOO_LARGE__':body;\
}}catch(e){{return '';}}}})()",
    )
}

/// Fills the shared recogniser with the values this run is asking about.
fn inspection_script(platform: &str) -> Result<String, String> {
    let platform_json = serde_json::to_string(platform)
        .map_err(|error| format!("inspection_platform_shape: {error}"))?;
    let marker_json = serde_json::to_string(HH_SIGNED_IN_SELECTOR)
        .map_err(|error| format!("inspection_selector_shape: {error}"))?;
    Ok(INSPECTION_SCRIPT
        .replace(PLATFORM_PLACEHOLDER, &platform_json)
        .replace(HH_MARKER_PLACEHOLDER, &marker_json))
}

/// Returns the document currently shown to the candidate without navigating it.
/// This is the only safe operation while login, MFA or CAPTCHA may be active.
pub async fn inspect_session_page(
    app: &AppHandle,
    platform: &str,
) -> Result<SessionInspectionReport, String> {
    inspect_session_page_for(app, platform, None).await
}

pub async fn inspect_session_page_for(
    app: &AppHandle,
    platform: &str,
    session_key: Option<&str>,
) -> Result<SessionInspectionReport, String> {
    let (label, _) = session_window_label_for(platform, session_key)?;
    let window = app
        .get_webview(&label)
        .ok_or_else(|| "session_window_missing".to_string())?;
    let script = inspection_script(platform)?;
    let raw = eval_json(&window, &script).await?;
    serde_json::from_str::<SessionInspectionReport>(&raw)
        .map_err(|error| format!("inspection_shape: {error}"))
}

/// Reads a page **inside the session the candidate signed in to**. A separate
/// HTTP client cannot do this: it does not share the webview's cookie jar.
/// LinkedIn renders About, Experience and the rest only when they scroll into
/// view; a snapshot of the untouched page held the top card and the footer
/// alone (B264). Scrolls the window and LinkedIn's own scroll container until
/// the page stops growing, within a fixed step budget, then returns to the top.
/// A single "at the end" reading was not enough: LinkedIn appends the next
/// chunk (Languages on the profile, skills past the tenth) a beat after the
/// scroll lands, so the walk now waits for several quiet readings (B266).
const LAZY_SCROLL_MAX_STEPS: usize = 40;
/// The connections list appends ~7 cards a step (run 5: 1 053 cards in 150
/// steps); 450 steps let a network of ~3 000 finish, and the walk is also
/// bounded in time (B448). The time cap must let those steps run: on 29.10 a
/// step took ~2.2 s and 8 minutes stopped a 1 888 network at 1 363.
const CONNECTIONS_SCROLL_MAX_STEPS: usize = 450;
const CONNECTIONS_SCROLL_MAX_DURATION: Duration = Duration::from_secs(18 * 60);
const LAZY_SCROLL_MAX_DURATION: Duration = Duration::from_secs(3 * 60);
/// The list loads its next chunk well after the scroll lands; four quiet
/// readings ended run 4 after 7 steps (B448).
const CONNECTIONS_QUIET_READINGS: usize = 8;

#[derive(Debug, Clone, Copy)]
struct LazyScrollBudget {
    max_steps: usize,
    quiet_readings: usize,
    max_duration: Duration,
    /// Return only name, headline and profile path per card: the sanitized
    /// page of 1 000+ cards broke the body limit in run 5 (B448).
    compact_connections: bool,
}

fn lazy_scroll_budget(path: &str) -> LazyScrollBudget {
    if path.starts_with("/mynetwork/invite-connect/connections") {
        LazyScrollBudget {
            max_steps: CONNECTIONS_SCROLL_MAX_STEPS,
            quiet_readings: CONNECTIONS_QUIET_READINGS,
            max_duration: CONNECTIONS_SCROLL_MAX_DURATION,
            compact_connections: true,
        }
    } else if path.contains("/overlay/") {
        // A modal over the profile: its content is already in the dialog,
        // and scrolling under it let LinkedIn close it mid-read (29.10).
        LazyScrollBudget {
            max_steps: 0,
            quiet_readings: LAZY_SCROLL_QUIET_READINGS,
            max_duration: LAZY_SCROLL_MAX_DURATION,
            compact_connections: false,
        }
    } else {
        LazyScrollBudget {
            max_steps: LAZY_SCROLL_MAX_STEPS,
            quiet_readings: LAZY_SCROLL_QUIET_READINGS,
            max_duration: LAZY_SCROLL_MAX_DURATION,
            compact_connections: false,
        }
    }
}
const LAZY_SCROLL_STEP_DELAY: Duration = Duration::from_millis(900);
/// ±30 % around the step delay: no fixed-interval clockwork (security §3).
const LAZY_SCROLL_JITTER_PERCENT: u64 = 30;

/// The step delay spread by `LAZY_SCROLL_JITTER_PERCENT`, driven by `seed`.
fn jittered_step_delay(seed: u64) -> Duration {
    let base = LAZY_SCROLL_STEP_DELAY.as_millis() as u64;
    let spread = base * LAZY_SCROLL_JITTER_PERCENT / 100;
    Duration::from_millis(base - spread + seed % (2 * spread + 1))
}

fn clock_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::from(elapsed.subsec_nanos()))
        .unwrap_or(0)
}
// Four quiet readings (~3.6 s): through the tunnel LinkedIn's lower cards
// (Languages) arrive well after the scroll lands (B266, live walk 3).
const LAZY_SCROLL_QUIET_READINGS: usize = 4;
// The skills page grows in chunks of ten inside its own scroll container, which
// neither `window` nor `main` scrolling reached: the 23.10 walk read ten of 44
// skills (C13). The last row is brought into view, which scrolls every
// ancestor, and skill rows count like connection cards, so a new chunk resets
// the quiet readings even when the page height does not change.
const LAZY_SCROLL_SCRIPT: &str = "(function(){try{\
var step=Math.max(600,window.innerHeight);\
var box=document.querySelector('main');\
window.scrollBy(0,step);if(box){box.scrollTop+=step;}\
var rows=document.querySelectorAll('[componentkey^=\"com.linkedin.sdui.profile.skill(\"]:not([componentkey$=\"-divider\"])');\
var skills=rows.length;\
if(skills){rows[skills-1].scrollIntoView({block:'end'});}\
var root=document.scrollingElement||document.documentElement;\
var height=Math.max(root.scrollHeight,box?box.scrollHeight:0);\
var bottom=Math.max(window.scrollY+window.innerHeight,box?box.scrollTop+box.clientHeight:0);\
var cards=document.querySelectorAll('[componentkey^=\"ConnectionCard_\"]').length;\
return {height:height,atEnd:bottom>=height-4,cards:cards+skills};\
}catch(e){return {height:0,atEnd:true,cards:0};}})()";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LazyScrollState {
    height: f64,
    at_end: bool,
    /// Connection cards plus skill rows on the page; 0 on every other page.
    #[serde(default)]
    cards: u32,
}

/// Counts consecutive readings where the page sits at its end and has
/// neither grown nor gained a card.
fn next_quiet_readings(
    quiet: usize,
    state: &LazyScrollState,
    last_height: f64,
    last_cards: u32,
) -> usize {
    if state.at_end && (state.height - last_height).abs() < 1.0 && state.cards == last_cards {
        quiet + 1
    } else {
        0
    }
}

/// What one walk of a lazily loaded page saw.
#[derive(Debug, Default)]
struct LazyWalk {
    /// Card count on the page after each step, for the diagnostics log.
    cards_per_step: Vec<u32>,
    /// Cards with text the collector returned at each step.
    batch_per_step: Vec<usize>,
    /// The first collector failure, as a code, if any step failed.
    collect_error: Option<String>,
    /// Connections kept by the shell, merged from every step's batch.
    collected: CollectedConnections,
    /// The first path segment of a page the walk was moved to, if any.
    left_for: Option<String>,
}

/// Connection cards kept across the walk, by profile path, in first-seen
/// order. A reload or a blank page mid-walk loses nothing already read (B448).
#[derive(Debug, Default)]
struct CollectedConnections {
    order: Vec<String>,
    cards: std::collections::HashMap<String, (usize, String)>,
}

impl CollectedConnections {
    /// Keeps each card's fullest reading: a row the list later empties or
    /// trims never replaces one already read with more lines.
    fn merge(&mut self, batch: Vec<(String, String, usize)>) {
        for (path, html, lines) in batch {
            match self.cards.get(&path) {
                Some((known, _)) if *known >= lines => {}
                Some(_) => {
                    self.cards.insert(path, (lines, html));
                }
                None => {
                    self.order.push(path.clone());
                    self.cards.insert(path, (lines, html));
                }
            }
        }
    }

    fn len(&self) -> usize {
        self.order.len()
    }

    /// The minimal card list the TS parser reads, or `None` when empty.
    fn render(&self) -> Option<String> {
        if self.order.is_empty() {
            return None;
        }
        let cards: String = self
            .order
            .iter()
            .filter_map(|path| self.cards.get(path).map(|(_, html)| html.as_str()))
            .collect();
        Some(format!("<main>{cards}</main>"))
    }
}

/// Scrolls until the page stops growing, within the budget. On the
/// connections list it also reads each step's cards into the shell and stops
/// when the window is moved off the list, keeping what it already read.
/// A script dropped by a LinkedIn navigation counts as a step, not the end.
async fn load_lazy_sections(window: &Webview, budget: LazyScrollBudget) -> LazyWalk {
    let mut walk = LazyWalk::default();
    let mut last_height = -1.0;
    let mut last_cards = 0;
    let mut quiet = 0;
    let deadline = tokio::time::Instant::now() + budget.max_duration;
    for _ in 0..budget.max_steps {
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        if budget.compact_connections {
            let current = window.url().map(|url| url.to_string()).unwrap_or_default();
            if !is_connections_page_url(&current) {
                walk.left_for = Some(first_path_segment(&current).to_string());
                break;
            }
        }
        let raw = match eval_json(window, LAZY_SCROLL_SCRIPT).await {
            Ok(raw) => raw,
            Err(error) if is_transient_eval_error(&error) => {
                tokio::time::sleep(PAGE_POLL_INTERVAL).await;
                continue;
            }
            Err(_) => break,
        };
        tokio::time::sleep(jittered_step_delay(clock_seed())).await;
        let Ok(state) = serde_json::from_str::<LazyScrollState>(&raw) else {
            break;
        };
        walk.cards_per_step.push(state.cards);
        if budget.compact_connections {
            // Before the list recycles the rows that just scrolled past.
            let batch = eval_json(window, connections_collect_call())
                .await
                .and_then(|json| {
                    serde_json::from_str::<String>(&json)
                        .and_then(|batch| {
                            serde_json::from_str::<Vec<(String, String, usize)>>(&batch)
                        })
                        .map_err(|_| "collect_shape".to_string())
                });
            match batch {
                Ok(batch) => {
                    walk.batch_per_step.push(batch.len());
                    walk.collected.merge(batch);
                }
                Err(error) => {
                    walk.batch_per_step.push(0);
                    walk.collect_error.get_or_insert(error);
                }
            }
        }
        quiet = next_quiet_readings(quiet, &state, last_height, last_cards);
        if quiet >= budget.quiet_readings {
            break;
        }
        last_height = state.height;
        last_cards = state.cards;
    }
    let _ = eval_json(
        window,
        "(function(){window.scrollTo(0,0);var box=document.querySelector('main');if(box){box.scrollTop=0;}return true;})()",
    )
    .await;
    tokio::time::sleep(PAGE_SETTLE_DELAY).await;
    walk
}

fn search_page_entry_refused(platform: &str, path: &str) -> bool {
    platform == "linkedin" && is_people_search_page(path)
}

/// The candidate's LinkedIn session is paced here, not only in the web layer
/// (B266 security WARN); see `linkedin_read_guard`. People search runs on its
/// own budget with a jittered 20–40 s gap (B561).
fn admit_linkedin_read(app: &AppHandle, path: &str) -> Result<Duration, String> {
    let state = app.state::<LinkedInReadGuardState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "linkedin_read_guard_unavailable".to_string())?;
    let now = std::time::Instant::now();
    let admitted = if is_people_search_page(path) {
        guard.admit_search(now, Duration::from_millis(clock_seed() % 20_001))
    } else {
        guard.admit(now, is_detail_page(path))
    };
    admitted.map_err(str::to_string)
}

/// Spaces a sign-in window navigation without spending the read budget; a
/// poisoned guard only skips the pause, it never blocks the sign-in.
fn pace_linkedin_navigation(app: &AppHandle) -> Duration {
    app.state::<LinkedInReadGuardState>()
        .0
        .lock()
        .map(|mut guard| guard.pace(std::time::Instant::now()))
        .unwrap_or_default()
}

pub async fn read_session_page(
    app: &AppHandle,
    request: &SessionWindowRequest,
) -> Result<SessionPageReport, String> {
    let (label, url, _) = validate(request)?;
    let scroll_budget = lazy_scroll_budget(url.path());
    let requested_url = url.to_string();
    let window = app
        .get_webview(&label)
        .ok_or_else(|| "session_window_missing".to_string())?;
    if request.platform == "linkedin" && request.session_key.is_none() {
        tokio::time::sleep(admit_linkedin_read(app, url.path())?).await;
    }

    // LinkedIn rewrites the query and trailing slash of a page it just
    // served; comparing the whole URL navigated again mid-load (B448).
    let already_there = window
        .url()
        .is_ok_and(|current| same_page(current.as_str(), url.as_str()));
    if !already_there {
        read_diagnostic(
            app,
            request,
            "navigate",
            Some(first_path_segment(url.as_str())),
        );
        window
            .navigate(url)
            .map_err(|error| format!("navigate_failed: {error}"))?;
        tokio::time::sleep(PAGE_POLL_INTERVAL).await;
    }

    let deadline = tokio::time::Instant::now() + PAGE_READY_TIMEOUT;
    let mut interactive_since: Option<tokio::time::Instant> = None;
    loop {
        // A check that runs while the page unloads is dropped by WebKit
        // (`eval_cancelled`): the page is not ready yet, so poll again (B448).
        let state = match read_document_state(&window).await {
            Ok(state) => state,
            Err(error) if is_transient_eval_error(&error) => {
                read_diagnostic(app, request, "load_retry", Some(&error));
                interactive_since = None;
                if tokio::time::Instant::now() >= deadline {
                    return Err("page_load_timeout".to_string());
                }
                tokio::time::sleep(PAGE_POLL_INTERVAL).await;
                continue;
            }
            Err(error) => return Err(error),
        };
        let interactive_for = if state.ready == "interactive" {
            interactive_since
                .get_or_insert_with(tokio::time::Instant::now)
                .elapsed()
        } else {
            Duration::ZERO
        };
        if !state.href.is_empty()
            && page_ready_to_read(&request.platform, &state.ready, interactive_for)
        {
            tokio::time::sleep(PAGE_SETTLE_DELAY).await;
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("page_load_timeout".to_string());
        }
        tokio::time::sleep(PAGE_POLL_INTERVAL).await;
    }

    if request.platform == "linkedin" {
        let started = std::time::Instant::now();
        let walk = load_lazy_sections(&window, scroll_budget).await;
        if scroll_budget.compact_connections {
            let millis = started.elapsed().as_millis().to_string();
            read_diagnostic(app, request, "walk_ms", Some(&millis));
            for (cards, batch) in walk.cards_per_step.iter().zip(&walk.batch_per_step) {
                read_diagnostic(app, request, "cards", Some(&cards.to_string()));
                read_diagnostic(app, request, "step_cards", Some(&batch.to_string()));
            }
            if let Some(error) = walk.collect_error.as_deref() {
                let code = first_code(error);
                read_diagnostic(app, request, "collect_failed", Some(code));
            }
            if let Some(segment) = walk.left_for.as_deref() {
                read_diagnostic(app, request, "left", Some(segment));
            }
            let collected = walk.collected.len().to_string();
            read_diagnostic(app, request, "collected", Some(&collected));
        }
        let steps = walk.cards_per_step.len().to_string();
        read_diagnostic(app, request, "scrolled", Some(&steps));
        // The cards were read on the connections list, even if the window
        // has since moved; report them as that page (B448, run 7).
        if let Some(body) = walk.collected.render() {
            let body = validate_page_body(body)?;
            read_diagnostic(app, request, "read", Some("mynetwork"));
            return Ok(SessionPageReport {
                ok: true,
                url: requested_url,
                body,
            });
        }
        if scroll_budget.compact_connections {
            // A full sanitize of a list this long exceeds the body limit by
            // design (run 8); an empty list ends in `no_contacts` instead.
            read_diagnostic(app, request, "compact_empty", None);
            return Ok(SessionPageReport {
                ok: true,
                url: requested_url,
                body: "<main></main>".to_string(),
            });
        }
    }

    let body_json = sanitized_page_json(app, request, &window).await?;
    let body = validate_page_body(
        serde_json::from_str::<String>(&body_json)
            .map_err(|error| format!("body_shape: {error}"))?,
    )?;
    let final_url = match read_document_state(&window).await {
        Ok(state) => state.href,
        Err(_) => window.url().map(|url| url.to_string()).unwrap_or_default(),
    };
    read_diagnostic(app, request, "read", Some(first_path_segment(&final_url)));

    Ok(SessionPageReport {
        ok: !body.is_empty(),
        url: final_url,
        body,
    })
}

const SANITIZE_ATTEMPTS: usize = 3;

/// The sanitize pass, retried when a late LinkedIn navigation drops it.
async fn sanitized_page_json(
    app: &AppHandle,
    request: &SessionWindowRequest,
    window: &Webview,
) -> Result<String, String> {
    let mut last_error = String::new();
    for _ in 0..SANITIZE_ATTEMPTS {
        match eval_json(window, &page_sanitize_script(&request.platform)).await {
            Ok(json) => return Ok(json),
            Err(error) if is_transient_eval_error(&error) => {
                read_diagnostic(app, request, "sanitize_retry", Some(&error));
                last_error = error;
                tokio::time::sleep(PAGE_SETTLE_DELAY).await;
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error)
}

/// Reads the connection cards showing text now; see the script's own header.
const CONNECTIONS_COLLECT_SCRIPT: &str = include_str!("connections_collect.js");

/// The script as the page runs it: the file is already self-invoking, and
/// wrapping it again turned its trailing `;` into a syntax error (run 8).
fn connections_collect_call() -> &'static str {
    CONNECTIONS_COLLECT_SCRIPT
}

/// The leading `snake_case` code of an error, for the diagnostics log.
fn first_code(error: &str) -> &str {
    let end = error
        .find(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'))
        .unwrap_or(error.len())
        .min(60);
    if end == 0 {
        "unknown"
    } else {
        &error[..end]
    }
}

/// `eval_cancelled` / `eval_timeout`: the page moved under the script.
fn is_transient_eval_error(error: &str) -> bool {
    error == "eval_cancelled" || error == "eval_timeout"
}

/// Same host and path, ignoring the query, fragment and a trailing slash.
fn same_page(current: &str, wanted: &str) -> bool {
    match (Url::parse(current), Url::parse(wanted)) {
        (Ok(a), Ok(b)) => {
            a.host_str() == b.host_str()
                && a.path().trim_end_matches('/') == b.path().trim_end_matches('/')
        }
        _ => false,
    }
}

/// The first path segment as a log code (`mynetwork`, `checkpoint`, `in`).
fn first_path_segment(raw: &str) -> &str {
    let path = raw
        .split_once("://")
        .and_then(|(_, rest)| rest.split_once('/'))
        .map(|(_, path)| path)
        .unwrap_or("");
    let segment = path.split(['/', '?', '#']).next().unwrap_or("");
    if segment.is_empty() {
        "root"
    } else if segment.len() <= 40
        && segment
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        segment
    } else {
        "other"
    }
}

/// Steps of the candidate's own LinkedIn reads in the local diagnostics log.
fn read_diagnostic(
    app: &AppHandle,
    request: &SessionWindowRequest,
    event: &str,
    detail: Option<&str>,
) {
    if request.platform == "linkedin" && request.session_key.is_none() {
        let _ = append_connector_diagnostic(app, "linkedin-read", event, detail);
    }
}

/// Kept on this machine only (B448): a sanitized LinkedIn page that yielded
/// nothing, so the parser can be tuned to the real markup. Never uploaded.
const CAPTURE_DUMP_DIR: &str = "capture-dumps";
const CAPTURE_DUMPS_KEPT: usize = 10;

/// `linkedin-<kind>-<millis>.html`, or `None` for a kind outside `[a-z-]{1,40}`.
fn capture_dump_file_name(kind: &str, millis: u128) -> Option<String> {
    let valid = !kind.is_empty()
        && kind.len() <= 40
        && kind.chars().all(|c| c.is_ascii_lowercase() || c == '-');
    valid.then(|| format!("linkedin-{kind}-{millis}.html"))
}

/// The oldest dumps beyond `CAPTURE_DUMPS_KEPT`; names sort by their timestamp
/// within one kind, and every kind is pruned together by name order.
fn capture_dumps_to_prune(mut names: Vec<String>) -> Vec<String> {
    names.retain(|name| name.starts_with("linkedin-") && name.ends_with(".html"));
    names.sort_by_key(|name| {
        name.trim_end_matches(".html")
            .rsplit('-')
            .next()
            .and_then(|millis| millis.parse::<u128>().ok())
            .unwrap_or(0)
    });
    let excess = names.len().saturating_sub(CAPTURE_DUMPS_KEPT);
    names.into_iter().take(excess).collect()
}

fn is_connections_page_url(raw: &str) -> bool {
    Url::parse(raw).is_ok_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| host_belongs_to(host, "linkedin.com"))
            && url
                .path()
                .starts_with("/mynetwork/invite-connect/connections")
    })
}

/// Saves the open LinkedIn session page through the same sanitizer as
/// `read_session_page`; the caller cannot hand in a body of its own.
pub async fn save_session_capture_dump(app: &AppHandle, kind: &str) -> Result<String, String> {
    let saved = write_session_capture_dump(app, kind).await;
    if let Err(error) = &saved {
        let _ = append_connector_diagnostic(
            app,
            "linkedin-read",
            "dump_failed",
            Some(first_code(error)),
        );
    }
    saved
}

async fn write_session_capture_dump(app: &AppHandle, kind: &str) -> Result<String, String> {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let name = capture_dump_file_name(kind, millis).ok_or("capture_dump_kind_invalid")?;
    let label = session_window_label("linkedin").ok_or("session_window_missing")?;
    let window = app
        .get_webview(label)
        .ok_or_else(|| "session_window_missing".to_string())?;
    // Only the connections list is ever kept: never a profile, feed or message page.
    if !window
        .url()
        .is_ok_and(|current| is_connections_page_url(current.as_str()))
    {
        return Err("capture_dump_page_not_allowed".to_string());
    }
    let body_json = eval_json(&window, &page_sanitize_script("linkedin")).await?;
    let body = validate_page_body(
        serde_json::from_str::<String>(&body_json)
            .map_err(|error| format!("body_shape: {error}"))?,
    )?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("capture_dump_dir_unavailable: {error}"))?
        .join(CAPTURE_DUMP_DIR);
    create_private_directory(&root)?;
    std::fs::write(root.join(&name), body)
        .map_err(|error| format!("capture_dump_write_failed: {error}"))?;
    let existing = std::fs::read_dir(&root)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for stale in capture_dumps_to_prune(existing) {
        let _ = std::fs::remove_file(root.join(stale));
    }
    Ok(name)
}

/// Local diagnostics for background connector reads (B448): the candidate
/// never sees it, the team can read it. Codes only, never page text.
const DIAGNOSTICS_DIR: &str = "diagnostics";
const DIAGNOSTICS_FILE: &str = "connector.log";
const DIAGNOSTICS_MAX_BYTES: u64 = 256 * 1_024;

fn diagnostic_token(value: &str, max_len: usize) -> Option<&str> {
    let valid = !value.is_empty()
        && value.len() <= max_len
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
    valid.then_some(value)
}

/// `<unix-ms> <scope> <event> [detail]`, or `None` when any part is not a plain code.
fn diagnostic_line(millis: u128, scope: &str, event: &str, detail: Option<&str>) -> Option<String> {
    let scope = diagnostic_token(scope, 40)?;
    let event = diagnostic_token(event, 60)?;
    let detail = match detail {
        Some(value) => format!(" {}", diagnostic_token(value, 60)?),
        None => String::new(),
    };
    Some(format!("{millis} {scope} {event}{detail}\n"))
}

pub fn append_connector_diagnostic(
    app: &AppHandle,
    scope: &str,
    event: &str,
    detail: Option<&str>,
) -> Result<(), String> {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let line = diagnostic_line(millis, scope, event, detail).ok_or("diagnostic_invalid")?;
    eprint!("[connector-diagnostic] {line}");
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("diagnostics_dir_unavailable: {error}"))?
        .join(DIAGNOSTICS_DIR);
    create_private_directory(&root)?;
    let path = root.join(DIAGNOSTICS_FILE);
    if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > DIAGNOSTICS_MAX_BYTES) {
        let _ = std::fs::rename(&path, root.join(format!("{DIAGNOSTICS_FILE}.1")));
    }
    use std::io::Write;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(line.as_bytes()))
        .map_err(|error| format!("diagnostics_write_failed: {error}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_session_window_never_opens_on_a_people_search_page() {
        assert!(search_page_entry_refused(
            "linkedin",
            "/search/results/people/"
        ));
        assert!(search_page_entry_refused(
            "linkedin",
            "/search/results/%70eople"
        ));
        assert!(!search_page_entry_refused("linkedin", "/feed/"));
        assert!(!search_page_entry_refused("hh", "/search/results/people/"));
    }

    #[test]
    fn error_codes_stop_at_the_first_non_code_character() {
        assert_eq!(first_code("eval_failed: boom"), "eval_failed");
        assert_eq!(first_code("collect_shape"), "collect_shape");
        assert_eq!(first_code(": nothing"), "unknown");
    }

    #[test]
    fn the_collector_runs_unwrapped() {
        let call = connections_collect_call().trim_end();
        assert!(call.starts_with("/**"));
        assert!(call.ends_with("})();"));
    }

    #[test]
    fn collected_cards_survive_rows_that_empty_or_trim_later() {
        let mut collected = CollectedConnections::default();
        collected.merge(vec![
            ("/in/a/".into(), "<div>a2</div>".into(), 2),
            ("/in/b/".into(), "<div>b1</div>".into(), 1),
        ]);
        collected.merge(vec![
            ("/in/a/".into(), "<div>a1</div>".into(), 1),
            ("/in/b/".into(), "<div>b2</div>".into(), 2),
            ("/in/c/".into(), "<div>c2</div>".into(), 2),
        ]);
        collected.merge(Vec::new());
        assert_eq!(collected.len(), 3);
        assert_eq!(
            collected.render().as_deref(),
            Some("<main><div>a2</div><div>b2</div><div>c2</div></main>")
        );
        assert_eq!(CollectedConnections::default().render(), None);
    }

    #[test]
    fn the_connections_list_gets_a_longer_and_more_patient_walk() {
        let connections = lazy_scroll_budget("/mynetwork/invite-connect/connections/");
        assert_eq!(
            (connections.max_steps, connections.quiet_readings),
            (450, 8)
        );
        // 29.10: at ~2.2 s a step the 8-minute cap stopped a 1 888 network at 1 363.
        assert_eq!(connections.max_duration, Duration::from_secs(18 * 60));
        assert!(connections.compact_connections);
        let profile = lazy_scroll_budget("/in/someone/");
        assert_eq!((profile.max_steps, profile.quiet_readings), (40, 4));
        assert!(!profile.compact_connections);
    }

    #[test]
    fn new_cards_keep_the_walk_going_even_when_the_height_holds() {
        let state = LazyScrollState {
            height: 5_000.0,
            at_end: true,
            cards: 120,
        };
        assert_eq!(next_quiet_readings(3, &state, 5_000.0, 100), 0);
        assert_eq!(next_quiet_readings(3, &state, 5_000.0, 120), 4);
    }

    #[test]
    fn a_rewritten_query_or_slash_is_the_same_page() {
        assert!(same_page(
            "https://www.linkedin.com/mynetwork/invite-connect/connections?x=1",
            "https://www.linkedin.com/mynetwork/invite-connect/connections/"
        ));
        assert!(!same_page(
            "https://www.linkedin.com/feed/",
            "https://www.linkedin.com/mynetwork/invite-connect/connections/"
        ));
    }

    #[test]
    fn only_a_dropped_script_is_retried() {
        assert!(is_transient_eval_error("eval_cancelled"));
        assert!(is_transient_eval_error("eval_timeout"));
        assert!(!is_transient_eval_error("session_window_missing"));
    }

    #[test]
    fn path_segment_is_a_plain_code() {
        assert_eq!(
            first_path_segment("https://www.linkedin.com/checkpoint/challenge/x"),
            "checkpoint"
        );
        assert_eq!(first_path_segment("https://www.linkedin.com/"), "root");
        assert_eq!(
            first_path_segment("https://www.linkedin.com/in/Ирина/"),
            "in"
        );
        assert_eq!(first_path_segment("not a url"), "root");
    }

    #[test]
    fn diagnostic_line_keeps_codes_and_refuses_free_text() {
        assert_eq!(
            diagnostic_line(
                5,
                "linkedin-contacts",
                "read_failed",
                Some("page_load_timeout")
            )
            .as_deref(),
            Some("5 linkedin-contacts read_failed page_load_timeout\n")
        );
        assert_eq!(
            diagnostic_line(5, "linkedin-contacts", "uploading", Some("42")).as_deref(),
            Some("5 linkedin-contacts uploading 42\n")
        );
        assert_eq!(
            diagnostic_line(5, "linkedin-contacts", "Ирина Котова", None),
            None
        );
        assert_eq!(
            diagnostic_line(5, "linkedin-contacts", "ok", Some("a b")),
            None
        );
    }

    #[test]
    fn capture_dump_name_accepts_only_a_plain_kind() {
        assert_eq!(
            capture_dump_file_name("connections", 1_700_000_000_000).as_deref(),
            Some("linkedin-connections-1700000000000.html")
        );
        assert_eq!(capture_dump_file_name("../etc", 1), None);
        assert_eq!(capture_dump_file_name("", 1), None);
        assert_eq!(capture_dump_file_name("Conn", 1), None);
    }

    #[test]
    fn capture_dump_is_limited_to_the_connections_page() {
        assert!(is_connections_page_url(
            "https://www.linkedin.com/mynetwork/invite-connect/connections/"
        ));
        assert!(!is_connections_page_url(
            "https://www.linkedin.com/in/someone/"
        ));
        assert!(!is_connections_page_url(
            "https://www.linkedin.com/messaging/"
        ));
        assert!(!is_connections_page_url(
            "https://evil.example/mynetwork/invite-connect/connections/"
        ));
    }

    #[test]
    fn capture_dumps_keep_only_the_newest_ten() {
        let names: Vec<String> = (1..=12)
            .map(|n| format!("linkedin-connections-{n}.html"))
            .chain(["notes.txt".to_string()])
            .collect();
        assert_eq!(
            capture_dumps_to_prune(names),
            vec![
                "linkedin-connections-1.html".to_string(),
                "linkedin-connections-2.html".to_string()
            ]
        );
    }

    use super::*;

    #[test]
    fn hh_page_is_readable_once_it_stays_interactive() {
        let grace = HH_INTERACTIVE_GRACE;
        assert!(page_ready_to_read("hh", "complete", Duration::ZERO));
        assert!(page_ready_to_read("hh", "interactive", grace));
        assert!(!page_ready_to_read(
            "hh",
            "interactive",
            grace - Duration::from_millis(1)
        ));
        assert!(!page_ready_to_read("hh", "loading", grace * 10));
    }

    #[test]
    fn linkedin_page_still_waits_for_complete() {
        assert!(page_ready_to_read("linkedin", "complete", Duration::ZERO));
        assert!(!page_ready_to_read(
            "linkedin",
            "interactive",
            HH_INTERACTIVE_GRACE * 10
        ));
    }

    fn scroll_state(height: f64, at_end: bool) -> LazyScrollState {
        LazyScrollState {
            height,
            at_end,
            cards: 0,
        }
    }

    #[cfg(unix)]
    #[test]
    fn managed_profile_directories_are_private_to_the_owner() {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!("openqareer-profile-{}", Uuid::new_v4()));
        create_private_directory(&path).expect("create private managed profile");
        let mode = std::fs::metadata(&path)
            .expect("read managed profile permissions")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o700);
        std::fs::remove_dir_all(path).expect("remove temporary managed profile");
    }

    #[cfg(unix)]
    #[test]
    fn candidate_session_directories_are_private_to_the_bound_account() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("openqareer-candidate-{}", Uuid::new_v4()));
        let key = format!("{}", "a".repeat(CANDIDATE_ACCOUNT_KEY_LENGTH));
        let directory =
            candidate_data_directory(&root, &key).expect("create candidate session store");
        assert!(directory.ends_with(&key[..32]));
        for path in [&root.join("candidate-sessions"), &directory] {
            let mode = std::fs::metadata(path)
                .expect("read private directory")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }
        std::fs::remove_dir_all(root).expect("remove temporary candidate session store");
    }

    #[test]
    fn custom_linkedin_data_store_requires_macos_14() {
        assert!(!supports_custom_store_on_macos(13));
        assert!(supports_custom_store_on_macos(14));
        assert!(supports_custom_store_on_macos(15));
    }

    #[test]
    fn older_macos_can_delete_server_state_when_no_local_profile_exists() {
        assert!(can_clear_managed_profile(false, false, false));
        assert!(!can_clear_managed_profile(false, true, false));
        assert!(!can_clear_managed_profile(false, false, true));
        assert!(can_clear_managed_profile(true, true, true));
    }

    #[test]
    fn lazy_scroll_waits_for_several_quiet_readings_before_stopping() {
        let mut quiet = 0;
        for _ in 0..LAZY_SCROLL_QUIET_READINGS - 1 {
            quiet = next_quiet_readings(quiet, &scroll_state(5_000.0, true), 5_000.0, 0);
            assert!(quiet < LAZY_SCROLL_QUIET_READINGS);
        }
        quiet = next_quiet_readings(quiet, &scroll_state(5_000.0, true), 5_000.0, 0);
        assert_eq!(quiet, LAZY_SCROLL_QUIET_READINGS);
        const { assert!(LAZY_SCROLL_QUIET_READINGS >= 4) };
    }

    #[test]
    fn lazy_scroll_brings_the_last_skill_row_into_view_and_counts_skill_rows() {
        // C13: the live skills page stopped at LinkedIn's first chunk of ten.
        assert!(LAZY_SCROLL_SCRIPT.contains("scrollIntoView"));
        assert!(LAZY_SCROLL_SCRIPT.contains("com.linkedin.sdui.profile.skill("));
        assert!(LAZY_SCROLL_SCRIPT.contains("cards:cards+skills"));
    }

    #[test]
    fn overlay_pages_are_read_without_scrolling() {
        // The contact-info overlay is a modal: the profile behind it kept
        // loading, so the walk scrolled 40 steps under it and the read came
        // back from another page (live walk 29.10, «контакты» failed twice).
        assert_eq!(
            lazy_scroll_budget("/in/jane-doe/overlay/contact-info/").max_steps,
            0
        );
        assert_eq!(
            lazy_scroll_budget("/in/jane-doe/details/skills/").max_steps,
            LAZY_SCROLL_MAX_STEPS
        );
    }

    #[test]
    fn lazy_scroll_step_delay_stays_within_thirty_percent() {
        for seed in [0, 1, 269, 270, 540, 541, 999_999_937] {
            let delay = jittered_step_delay(seed).as_millis();
            assert!((630..=1_170).contains(&delay), "{delay}");
        }
        assert_ne!(jittered_step_delay(0), jittered_step_delay(540));
    }

    #[test]
    fn lazy_scroll_restarts_the_count_when_linkedin_appends_a_chunk() {
        assert_eq!(
            next_quiet_readings(1, &scroll_state(7_400.0, true), 5_000.0, 0),
            0
        );
        assert_eq!(
            next_quiet_readings(1, &scroll_state(5_000.0, false), 5_000.0, 0),
            0
        );
    }

    #[test]
    fn linkedin_id_is_allowed_only_with_the_sdui_profile_card_prefix() {
        assert!(linkedin_id_allowed(
            "com.linkedin.sdui.profile.card.ref-experience-1"
        ));
        assert!(!linkedin_id_allowed("ember-view-42"));
        assert!(!linkedin_id_allowed(""));
    }

    #[test]
    fn linkedin_href_keeps_allowed_paths_and_strips_query_off_them() {
        assert_eq!(
            linkedin_href_allowed("https://www.linkedin.com/in/jane-doe/?trk=xyz").as_deref(),
            Some("/in/jane-doe/")
        );
        assert_eq!(
            linkedin_href_allowed("https://linkedin.com/company/acme").as_deref(),
            Some("/company/acme")
        );
        assert_eq!(linkedin_href_allowed("https://evil.example/in/jane"), None);
        assert_eq!(
            linkedin_href_allowed("https://linkedin.com/feed/update/123"),
            None
        );
    }

    #[test]
    fn linkedin_href_keeps_the_query_only_for_safety_go() {
        let kept = linkedin_href_allowed("https://linkedin.com/safety/go/?url=https%3A%2F%2Fx.com");
        assert_eq!(kept.as_deref(), Some("/safety/go/?url=https%3A%2F%2Fx.com"));
    }

    #[test]
    fn linkedin_image_src_is_scoped_to_the_licdn_dms_path() {
        assert!(linkedin_image_src_allowed(
            "https://media.licdn.com/dms/image/abc/profile.jpg"
        ));
        assert!(!linkedin_image_src_allowed(
            "https://evil.example/dms/image/x"
        ));
        assert!(!linkedin_image_src_allowed("data:image/png;base64,AAAA"));
    }

    #[test]
    fn srcset_variant_closest_to_400px_from_licdn_candidates_wins() {
        let srcset = "https://media.licdn.com/dms/image/a 100w, \
https://media.licdn.com/dms/image/b 400w, \
https://evil.example/c 400w, \
https://media.licdn.com/dms/image/c 800w";
        assert_eq!(
            pick_linkedin_srcset_variant(srcset).as_deref(),
            Some("https://media.licdn.com/dms/image/b")
        );
    }

    #[test]
    fn srcset_with_no_licdn_candidates_yields_nothing() {
        assert_eq!(
            pick_linkedin_srcset_variant("https://evil.example/x 400w"),
            None
        );
    }

    #[test]
    fn linkedin_sanitize_script_never_dispatches_or_clicks() {
        let script = page_sanitize_script("linkedin");
        assert!(!script.contains(".click("));
        assert!(!script.contains("dispatchEvent"));
        assert!(script.contains("com.linkedin.sdui.profile."));
        assert!(script.contains("componentkey"));
        assert!(script.contains("media.licdn.com/dms/image/"));
    }

    #[test]
    fn overlay_read_takes_the_dialog_with_the_most_visible_text() {
        // B264: ad dialogs («Ad Options») sit in every profile DOM; the first
        // dialog on the page is not the contact-info overlay (29.10).
        let script = page_sanitize_script("linkedin");
        assert!(!script.contains("document.querySelector('[role=dialog],dialog')"));
        assert!(script.contains("querySelectorAll('[role=dialog],dialog')"));
        assert!(script.contains("innerText"));
    }

    #[test]
    fn hh_sanitize_script_is_unchanged_by_the_linkedin_allowlist() {
        let script = page_sanitize_script("hh");
        assert!(!script.contains(".click("));
        assert!(!script.contains("dispatchEvent"));
        assert!(!script.contains("componentkey"));
        assert!(script.contains("resume"));
    }

    #[test]
    fn each_account_key_maps_to_its_own_store_identifier() {
        let first = "a".repeat(64);
        let second = format!("b{}", "a".repeat(63));
        assert!(is_valid_account_key(&first));
        assert_ne!(
            account_store_identifier(&first).unwrap(),
            account_store_identifier(&second).unwrap()
        );
        assert_eq!(account_store_identifier(&first).unwrap(), [0xaa; 16]);
    }

    #[test]
    fn an_account_key_must_be_a_lowercase_sha256_digest() {
        assert!(!is_valid_account_key("adenisov.test"));
        assert!(!is_valid_account_key(&"A".repeat(64)));
        assert!(!is_valid_account_key(&"a".repeat(63)));
        assert!(!is_valid_account_key(&format!("../{}", "a".repeat(61))));
    }

    #[test]
    fn the_reset_only_window_stays_inside_the_platforms_own_origins() {
        for platform in ["linkedin", "hh"] {
            let url = platform_root_url(platform).expect("a root url per platform");
            assert!(is_allowed_session_url(platform, url));
        }
        assert_eq!(platform_root_url("facebook"), None);
    }

    #[test]
    fn a_reload_of_the_application_page_orphans_both_sign_in_windows() {
        assert_eq!(
            sessions_orphaned_by_page_load(MAIN_WINDOW_LABEL),
            &["linkedin", "hh"]
        );
    }

    #[test]
    fn signing_in_inside_a_session_window_orphans_nothing() {
        assert!(sessions_orphaned_by_page_load("connector-hh").is_empty());
        assert!(sessions_orphaned_by_page_load("connector-linkedin").is_empty());
    }

    #[test]
    fn maps_only_the_two_supported_platforms_to_a_window() {
        assert_eq!(session_window_label("linkedin"), Some("connector-linkedin"));
        assert_eq!(session_window_label("hh"), Some("connector-hh"));
        assert_eq!(session_window_label("facebook"), None);
        assert_eq!(session_window_label(""), None);
    }

    #[test]
    fn gives_each_managed_linkedin_profile_its_own_window_label_and_store() {
        let (label, store) = session_window_label_for(
            "linkedin",
            Some("profile_123e4567-e89b-12d3-a456-426614174000"),
        )
        .expect("managed profile");
        assert!(label.starts_with(MANAGED_LINKEDIN_LABEL_PREFIX));
        assert_eq!(
            store,
            Some(
                Uuid::parse_str("123e4567-e89b-12d3-a456-426614174000")
                    .unwrap()
                    .into_bytes()
            )
        );
        assert_eq!(
            session_window_label_for("hh", Some("profile_123e4567-e89b-12d3-a456-426614174000")),
            Err("managed_session_platform_unsupported".to_string())
        );
        assert_eq!(
            session_window_label_for("linkedin", Some("profile-not-a-uuid")),
            Err("managed_session_key_invalid".to_string())
        );
    }

    #[test]
    fn managed_cookie_export_allows_only_linkedin_domains() {
        for domain in [
            "linkedin.com",
            ".linkedin.com",
            "www.linkedin.com",
            "linkedin.cn",
            "login.linkedin.cn",
        ] {
            assert!(is_linkedin_cookie_domain(domain), "{domain}");
        }
        for domain in [
            "notlinkedin.com",
            "linkedin.com.example.test",
            "google.com",
            "..linkedin.com",
        ] {
            assert!(!is_linkedin_cookie_domain(domain), "{domain}");
        }
    }

    #[test]
    fn each_platform_gets_its_own_webview2_folder_only_on_windows() {
        let root = std::env::temp_dir().join(format!("oq-platform-dir-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create account folder");
        let linkedin = super::platform_data_directory(root.clone(), "linkedin").expect("linkedin");
        let hh = super::platform_data_directory(root.clone(), "hh").expect("hh");
        if cfg!(windows) {
            assert_eq!(linkedin, root.join("linkedin"));
            assert_eq!(hh, root.join("hh"));
            assert!(linkedin.is_dir() && hh.is_dir());
        } else {
            assert_eq!(linkedin, root);
            assert_eq!(hh, root);
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn every_sign_in_window_is_a_native_macos_window() {
        // Mockup 12: frame, close/minimise/full screen, resizable, in the Dock.
        assert_eq!(session_window_chrome(true), (true, true, false));
        assert_eq!(session_window_chrome(false), (true, true, false));
    }

    #[test]
    fn title_bar_comes_from_the_nswindow_when_tao_reports_none() {
        assert_eq!(super::title_bar_offset(1612, 1612, 2.0, Some(28.0)), 28.0);
        assert_eq!(super::title_bar_offset(1668, 1612, 2.0, Some(28.0)), 28.0);
        assert_eq!(super::title_bar_offset(1612, 1612, 2.0, None), 0.0);
        assert_eq!(super::title_bar_offset(1612, 1612, 2.0, Some(500.0)), 0.0);
    }

    #[test]
    fn a_page_that_never_drew_shows_the_mockup_failure_with_a_retry() {
        let script = super::load_failure_script("linkedin.com", "https://www.linkedin.com/login");
        assert!(script.contains("Страница не открылась"));
        assert!(script.contains("Нет связи с linkedin.com. Проверьте сеть и повторите."));
        assert!(script.contains("Повторить"));
        assert!(script.contains("location.replace(\"https://www.linkedin.com/login\")"));
    }

    #[test]
    fn a_page_counts_as_drawn_once_it_has_text() {
        assert!(super::page_has_text("\"12\""));
        assert!(super::page_has_text("7"));
        assert!(!super::page_has_text("\"0\""));
        assert!(!super::page_has_text("null"));
    }

    #[test]
    fn sign_in_windows_are_top_level_not_overlays() {
        assert!(!should_parent_session_window(None));
        assert!(!should_parent_session_window(Some(
            "profile_123e4567-e89b-12d3-a456-426614174000"
        )));
    }

    #[test]
    fn accepts_the_platforms_own_https_hosts() {
        assert!(is_allowed_session_url(
            "linkedin",
            "https://www.linkedin.com/login"
        ));
        assert!(is_allowed_session_url(
            "linkedin",
            "https://linkedin.com/in/me/"
        ));
        assert!(is_allowed_session_url("hh", "https://hh.ru/account/login"));
        assert!(is_allowed_session_url(
            "hh",
            "https://spb.hh.ru/applicant/resumes"
        ));
    }

    #[test]
    fn allows_an_embedded_blank_document_without_weakening_session_entry_urls() {
        assert!(is_allowed_session_navigation_url("linkedin", "about:blank"));
        assert!(!is_allowed_session_url("linkedin", "about:blank"));
    }

    #[test]
    fn allows_only_linkedins_measured_sign_in_and_challenge_frame_origins() {
        for url in [
            "https://accounts.google.com/gsi/fedcm/listaccounts",
            "https://www.google.com/recaptcha/api2/anchor",
            "https://www.recaptcha.net/recaptcha/api2/anchor",
            "https://www.gstatic.com/recaptcha/releases/test.js",
            "https://li.protechts.net/challenge",
        ] {
            assert!(is_allowed_session_navigation_url("linkedin", url));
            assert!(!is_allowed_session_url("linkedin", url));
        }
        for url in [
            "https://google.com/search",
            "https://accounts.google.com.evil.tld/",
            "https://www.google.com.evil.tld/recaptcha",
            "https://evil.protechts.net/challenge",
        ] {
            assert!(!is_allowed_session_navigation_url("linkedin", url));
        }
        assert!(!is_allowed_session_navigation_url(
            "hh",
            "https://www.google.com/recaptcha/api2/anchor"
        ));
    }

    #[test]
    fn allows_hh_captcha_and_static_dependency_origins_only_for_hh() {
        for url in [
            "https://mc.yandex.ru/watch/1",
            "https://yastatic.net/smartcaptcha/captcha.js",
            "https://smartcaptcha.yandexcloud.net/captcha.js",
        ] {
            assert!(is_allowed_session_navigation_url("hh", url));
            assert!(!is_allowed_session_navigation_url("linkedin", url));
        }
        assert!(!is_allowed_session_navigation_url(
            "hh",
            "https://evil.yandex.ru.example/captcha"
        ));
    }

    #[test]
    fn rejects_lookalike_hosts_plain_http_and_cross_platform_urls() {
        assert!(!is_allowed_session_url(
            "linkedin",
            "https://linkedin.com.evil.tld/login"
        ));
        assert!(!is_allowed_session_url(
            "linkedin",
            "https://notlinkedin.com/login"
        ));
        assert!(!is_allowed_session_url(
            "linkedin",
            "https://attacker@www.linkedin.com/login"
        ));
        assert!(!is_allowed_session_url(
            "hh",
            "https://hh.ru:8443/account/login"
        ));
        assert!(!is_allowed_session_url("hh", "http://hh.ru/account/login"));
        assert!(!is_allowed_session_url(
            "hh",
            "https://www.linkedin.com/login"
        ));
        assert!(!is_allowed_session_url("linkedin", "javascript:alert(1)"));
        assert!(!is_allowed_session_url("linkedin", "not a url"));
        assert!(!is_allowed_session_url(
            "unknown",
            "https://www.linkedin.com/login"
        ));
    }

    #[test]
    fn never_routes_through_a_tunnel_that_is_not_running() {
        assert!(!should_route_through_tunnel(
            "https://www.linkedin.com/in/me/",
            false
        ));
        assert!(should_route_through_tunnel(
            "https://www.linkedin.com/in/me/",
            true
        ));
    }

    #[test]
    fn keeps_hh_and_our_own_api_off_the_tunnel() {
        assert!(!should_route_through_tunnel(
            "https://hh.ru/applicant/resumes",
            true
        ));
        assert!(!should_route_through_tunnel(
            "https://openqareer.com/api/v1",
            true
        ));
        assert!(!should_route_through_tunnel(
            "https://linkedin.com.evil.tld/",
            true
        ));
        assert!(should_route_through_tunnel(
            "https://static.licdn.com/x.js",
            true
        ));
        for url in [
            "https://www.google.com/recaptcha/api2/anchor",
            "https://www.recaptcha.net/recaptcha/api2/anchor",
            "https://www.gstatic.com/recaptcha/releases/test.js",
            "https://li.protechts.net/challenge",
        ] {
            assert!(should_route_through_tunnel(url, true));
        }
        assert!(!should_route_through_tunnel(
            "https://www.google.com/recaptcha",
            false
        ));
    }

    #[test]
    fn rejects_provider_dom_larger_than_the_ipc_boundary() {
        assert_eq!(
            validate_page_body("__OPENQAREER_PAGE_TOO_LARGE__".to_string()),
            Err("page_body_too_large".to_string())
        );
        assert_eq!(
            validate_page_body("x".repeat(MAX_SESSION_PAGE_BODY_CHARS + 1)),
            Err("page_body_too_large".to_string())
        );
        assert_eq!(
            validate_page_body("profile".to_string()).unwrap(),
            "profile"
        );
    }

    #[test]
    fn linkedin_skill_row_ids_survive_the_allowlist() {
        assert!("com.linkedin.sdui.profile.skill(urn:li:fsd_skill:(A,1))"
            .starts_with(LINKEDIN_ID_PREFIX));
        assert!("com.linkedin.sdui.profile.card.refEXPERIENCE".starts_with(LINKEDIN_ID_PREFIX));
        assert!(!"ember123".starts_with(LINKEDIN_ID_PREFIX));
    }

    #[test]
    fn linkedin_allowlist_is_applied_after_the_attribute_wipe() {
        let script = page_sanitize_script("linkedin");
        let wipe = script
            .find("removeAttribute(attribute.name)")
            .expect("wipe");
        let keep_id = script.find("node.setAttribute('id',id)").expect("id rule");
        let keep_src = script
            .find("node.setAttribute('src',src)")
            .expect("src rule");
        assert!(
            keep_id > wipe,
            "id must be restored after the wipe, not before it"
        );
        assert!(
            keep_src > wipe,
            "src must be restored after the wipe, not before it"
        );
    }

    #[test]
    fn hh_sanitizer_keeps_no_linkedin_attributes() {
        let script = page_sanitize_script("hh");
        assert!(!script.contains("componentkey"));
        assert!(!script.contains("srcset"));
    }

    #[test]
    fn dump_linkedin_sanitizer_for_manual_check() {
        if std::env::var("DUMP_SANITIZER").is_ok() {
            std::fs::write(
                std::env::var("DUMP_SANITIZER").unwrap(),
                page_sanitize_script("linkedin"),
            )
            .unwrap();
        }
    }

    #[test]
    fn recognises_every_live_hh_applicant_menu_variant() {
        assert!(HH_SIGNED_IN_SELECTOR.contains("mainmenu_applicantProfile"));
        assert!(HH_SIGNED_IN_SELECTOR.contains("mainmenu_profileAndResumes"));
        assert!(HH_SIGNED_IN_SELECTOR.contains("profile-activator"));
    }
}
