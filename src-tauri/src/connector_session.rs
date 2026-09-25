//! Native platform sign-in sessions for the desktop companion.
//!
//! The candidate signs in to LinkedIn or hh.ru **in the platform's own page**,
//! inside a window this application owns. `window.open` cannot do that here:
//! Tauri only installs a new-window handler for webviews that declare one, and
//! the main window is declared in `tauri.conf.json`, so WKWebView/WebView2
//! silently refuse the request and no window ever appears (B149).

use crate::linkedin_read_guard::{is_detail_page, LinkedInReadGuardState};
use serde::{Deserialize, Serialize};
use std::fs::create_dir_all;
use std::path::PathBuf;
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

fn session_window_chrome(managed: bool) -> (bool, bool, bool) {
    if managed {
        // Pool accounts need native close/resize controls because there is no
        // candidate wizard shell behind their standalone window.
        (true, true, false)
    } else {
        // Candidate sessions are visually hosted by the wizard modal.
        (false, false, true)
    }
}

fn should_parent_session_window(session_key: Option<&str>) -> bool {
    session_key.is_none()
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

/// The session window is ours: it may only ever hold the platform the candidate
/// asked for. A crafted URL must not turn it into a general-purpose browser.
pub fn is_allowed_session_url(platform: &str, url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
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
    let uuid = managed_session_uuid(session_key)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("managed_session_data_dir_unavailable: {error}"))?
        .join("linkedin-pool");
    let directory = root.join(format!("profile_{}", uuid.simple()));
    create_dir_all(&directory)
        .map_err(|error| format!("managed_session_data_dir_create_failed: {error}"))?;
    Ok(directory)
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
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("candidate_session_data_dir_unavailable: {error}"))?
        .join("candidate-sessions")
        .join(&key[..32]);
    create_dir_all(&directory)
        .map_err(|error| format!("candidate_session_data_dir_create_failed: {error}"))?;
    Ok((directory, identifier))
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

    if let Some(existing) = app.get_webview(&label) {
        if !existing.url().is_ok_and(|current| current == url) {
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
        let (data_directory, identifier) = match candidate_store(app) {
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

    // Candidate sessions are borderless overlays hosted by the wizard. A pool
    // session is a real standalone operator window; parenting a decorated
    // WebView on macOS can prevent it from being shown at all.
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
            if await_registered_window(app, &label).await {
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
    let Ok((data_directory, identifier)) = candidate_store(app) else {
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

fn screen_layout(layout: &SessionLayout, main: &tauri::WebviewWindow) -> SessionLayout {
    let scale = main.scale_factor().unwrap_or(1.0);
    let origin = main.inner_position().unwrap_or_default();
    SessionLayout {
        x: f64::from(origin.x) / scale + layout.x,
        y: f64::from(origin.y) / scale + layout.y,
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
const source=(location.pathname.indexOf('/overlay/')>=0&&document.querySelector('[role=dialog],dialog'))||document.querySelector('main')||document.body||document.documentElement;\
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
const LAZY_SCROLL_SCRIPT: &str = "(function(){try{\
var step=Math.max(600,window.innerHeight);\
var box=document.querySelector('main');\
window.scrollBy(0,step);if(box){box.scrollTop+=step;}\
var root=document.scrollingElement||document.documentElement;\
var height=Math.max(root.scrollHeight,box?box.scrollHeight:0);\
var bottom=Math.max(window.scrollY+window.innerHeight,box?box.scrollTop+box.clientHeight:0);\
return {height:height,atEnd:bottom>=height-4};\
}catch(e){return {height:0,atEnd:true};}})()";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LazyScrollState {
    height: f64,
    at_end: bool,
}

/// Counts consecutive readings where the page sits at its end and has not grown.
fn next_quiet_readings(quiet: usize, state: &LazyScrollState, last_height: f64) -> usize {
    if state.at_end && (state.height - last_height).abs() < 1.0 {
        quiet + 1
    } else {
        0
    }
}

async fn load_lazy_sections(window: &Webview) {
    let mut last_height = -1.0;
    let mut quiet = 0;
    for _ in 0..LAZY_SCROLL_MAX_STEPS {
        let Ok(raw) = eval_json(window, LAZY_SCROLL_SCRIPT).await else {
            break;
        };
        tokio::time::sleep(jittered_step_delay(clock_seed())).await;
        let Ok(state) = serde_json::from_str::<LazyScrollState>(&raw) else {
            break;
        };
        quiet = next_quiet_readings(quiet, &state, last_height);
        if quiet >= LAZY_SCROLL_QUIET_READINGS {
            break;
        }
        last_height = state.height;
    }
    let _ = eval_json(
        window,
        "(function(){window.scrollTo(0,0);var box=document.querySelector('main');if(box){box.scrollTop=0;}return true;})()",
    )
    .await;
    tokio::time::sleep(PAGE_SETTLE_DELAY).await;
}

/// The candidate's LinkedIn session is paced here, not only in the web layer
/// (B266 security WARN); see `linkedin_read_guard`.
fn admit_linkedin_read(app: &AppHandle, path: &str) -> Result<Duration, String> {
    let state = app.state::<LinkedInReadGuardState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "linkedin_read_guard_unavailable".to_string())?;
    guard
        .admit(std::time::Instant::now(), is_detail_page(path))
        .map_err(str::to_string)
}

pub async fn read_session_page(
    app: &AppHandle,
    request: &SessionWindowRequest,
) -> Result<SessionPageReport, String> {
    let (label, url, _) = validate(request)?;
    let window = app
        .get_webview(&label)
        .ok_or_else(|| "session_window_missing".to_string())?;
    if request.platform == "linkedin" && request.session_key.is_none() {
        tokio::time::sleep(admit_linkedin_read(app, url.path())?).await;
    }

    let already_there = window.url().is_ok_and(|current| current == url);
    if !already_there {
        window
            .navigate(url)
            .map_err(|error| format!("navigate_failed: {error}"))?;
        tokio::time::sleep(PAGE_POLL_INTERVAL).await;
    }

    let deadline = tokio::time::Instant::now() + PAGE_READY_TIMEOUT;
    loop {
        let state = read_document_state(&window).await?;
        if state.ready == "complete" && !state.href.is_empty() {
            tokio::time::sleep(PAGE_SETTLE_DELAY).await;
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("page_load_timeout".to_string());
        }
        tokio::time::sleep(PAGE_POLL_INTERVAL).await;
    }

    if request.platform == "linkedin" {
        load_lazy_sections(&window).await;
    }

    let body_json = eval_json(&window, &page_sanitize_script(&request.platform)).await?;
    let body = validate_page_body(
        serde_json::from_str::<String>(&body_json)
            .map_err(|error| format!("body_shape: {error}"))?,
    )?;
    let final_state = read_document_state(&window).await?;

    Ok(SessionPageReport {
        ok: !body.is_empty(),
        url: final_state.href,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scroll_state(height: f64, at_end: bool) -> LazyScrollState {
        LazyScrollState { height, at_end }
    }

    #[test]
    fn lazy_scroll_waits_for_several_quiet_readings_before_stopping() {
        let mut quiet = 0;
        for _ in 0..LAZY_SCROLL_QUIET_READINGS - 1 {
            quiet = next_quiet_readings(quiet, &scroll_state(5_000.0, true), 5_000.0);
            assert!(quiet < LAZY_SCROLL_QUIET_READINGS);
        }
        quiet = next_quiet_readings(quiet, &scroll_state(5_000.0, true), 5_000.0);
        assert_eq!(quiet, LAZY_SCROLL_QUIET_READINGS);
        const { assert!(LAZY_SCROLL_QUIET_READINGS >= 4) };
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
        assert_eq!(next_quiet_readings(1, &scroll_state(7_400.0, true), 5_000.0), 0);
        assert_eq!(next_quiet_readings(1, &scroll_state(5_000.0, false), 5_000.0), 0);
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
    fn gives_managed_windows_native_controls_without_changing_candidate_chrome() {
        assert_eq!(session_window_chrome(true), (true, true, false));
        assert_eq!(session_window_chrome(false), (false, false, true));
    }

    #[test]
    fn keeps_managed_pool_windows_top_level_but_parents_candidate_overlays() {
        assert!(should_parent_session_window(None));
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
