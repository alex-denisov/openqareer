//! Native platform sign-in sessions for the desktop companion.
//!
//! The candidate signs in to LinkedIn or hh.ru **in the platform's own page**,
//! inside a window this application owns. `window.open` cannot do that here:
//! Tauri only installs a new-window handler for webviews that declare one, and
//! the main window is declared in `tauri.conf.json`, so WKWebView/WebView2
//! silently refuse the request and no window ever appears (B149).

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl,
    WebviewWindowBuilder,
};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWindowRequest {
    pub platform: String,
    pub url: String,
    pub layout: Option<SessionLayout>,
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

fn validate(request: &SessionWindowRequest) -> Result<(&'static str, Url), String> {
    let label = session_window_label(&request.platform).ok_or("unsupported_platform")?;
    if !is_allowed_session_url(&request.platform, &request.url) {
        return Err("url_not_allowed".to_string());
    }
    let url = Url::parse(&request.url).map_err(|_| "url_not_allowed".to_string())?;
    Ok((label, url))
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
    let (label, url) = match validate(request) {
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
    let layout = request.layout.clone().unwrap_or(SessionLayout {
        x: 180.0,
        y: 140.0,
        width: 920.0,
        height: 620.0,
    });
    if layout.width < 320.0 || layout.height < 320.0 || layout.x < 0.0 || layout.y < 0.0 {
        return SessionWindowReport {
            opened: false,
            label: label.to_string(),
            reason: Some("session_layout_invalid".to_string()),
        };
    }

    if let Some(existing) = app.get_webview(label) {
        if !existing.url().is_ok_and(|current| current == url) {
            let _ = existing.navigate(url);
        }
        resize_session_window(app, &request.platform, layout.clone());
        if let Some(window) = app.get_webview_window(label) {
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
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(format!("OpenQareer · {}", platform_name(&request.platform)))
        .position(screen_layout.x, screen_layout.y)
        .inner_size(screen_layout.width, screen_layout.height)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .on_navigation(move |next_url| allow_session_navigation(&platform, next_url));

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

    if let Some(proxy) = proxy_url {
        builder = builder.proxy_url(proxy);
    }

    match builder.build() {
        Ok(_) => {
            // Reporting "opened" before the window is inspectable is what threw
            // the whole step back to idle on the very first poll (B157).
            if await_registered_window(app, label).await {
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
}

pub fn close_session_window(app: &AppHandle, platform: &str) -> bool {
    session_window_label(platform).is_some_and(|label| {
        app.get_webview_window(label)
            .is_some_and(|window| window.close().is_ok())
            || app
                .get_webview(label)
                .is_some_and(|webview| webview.close().is_ok())
    })
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
    tokio::time::sleep(Duration::from_millis(500)).await;
    close_session_window(app, platform)
}

/// Builds an invisible session window, kept to the same origin allow-list as
/// the visible one.
async fn open_hidden_session_window(app: &AppHandle, platform: &str, label: &str) -> bool {
    let Some(url) = platform_root_url(platform).and_then(|raw| Url::parse(raw).ok()) else {
        return false;
    };
    let allowed = platform.to_string();
    let built = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(format!("OpenQareer · {}", platform_name(platform)))
        .inner_size(480.0, 360.0)
        .visible(false)
        .skip_taskbar(true)
        .on_navigation(move |next| allow_session_navigation(&allowed, next))
        .build();
    built.is_ok() && await_registered_window(app, label).await
}

pub fn resize_session_window(app: &AppHandle, platform: &str, layout: SessionLayout) -> bool {
    if layout.width < 320.0 || layout.height < 320.0 || layout.x < 0.0 || layout.y < 0.0 {
        return false;
    }
    session_window_label(platform).is_some_and(|label| {
        if let Some(window) = app.get_webview_window(label) {
            let Some(main) = app.get_webview_window("main") else {
                return false;
            };
            let screen = screen_layout(&layout, &main);
            return window
                .set_position(LogicalPosition::new(screen.x, screen.y))
                .and_then(|_| window.set_size(LogicalSize::new(screen.width, screen.height)))
                .is_ok();
        }
        app.get_webview(label).is_some_and(|webview| {
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
    let label = session_window_label(platform).ok_or("unsupported_platform")?;
    let window = app
        .get_webview(label)
        .ok_or_else(|| "session_window_missing".to_string())?;
    let script = inspection_script(platform)?;
    let raw = eval_json(&window, &script).await?;
    serde_json::from_str::<SessionInspectionReport>(&raw)
        .map_err(|error| format!("inspection_shape: {error}"))
}

/// Reads a page **inside the session the candidate signed in to**. A separate
/// HTTP client cannot do this: it does not share the webview's cookie jar.
pub async fn read_session_page(
    app: &AppHandle,
    request: &SessionWindowRequest,
) -> Result<SessionPageReport, String> {
    let (label, url) = validate(request)?;
    let window = app
        .get_webview(label)
        .ok_or_else(|| "session_window_missing".to_string())?;

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

    let body_json = eval_json(
        &window,
        "(function(){try{\
const source=document.querySelector('main')||document.body||document.documentElement;\
const root=source.cloneNode(true);\
root.querySelectorAll('script,style,noscript,iframe,object,embed,input,textarea,select,meta,link').forEach(function(node){node.remove();});\
root.querySelectorAll('*').forEach(function(node){\
const qa=node.getAttribute('data-qa');\
const className=node.getAttribute('class');\
const href=node.getAttribute('href');\
Array.from(node.attributes).forEach(function(attribute){node.removeAttribute(attribute.name);});\
if(qa&&qa.length<=160){node.setAttribute('data-qa',qa);}\
if(className&&className.length<=500){node.setAttribute('class',className);}\
if(href){try{const parsed=new URL(href,location.origin);if(/^\\/resume\\/[A-Za-z0-9_-]+$/u.test(parsed.pathname)){node.setAttribute('href',parsed.pathname);}}catch(e){}}\
});\
const body=root.outerHTML;\
return body.length>2000000?'__OPENQAREER_PAGE_TOO_LARGE__':body;\
}catch(e){return '';}})()",
    )
    .await?;
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
        assert!(!should_route_through_tunnel("https://www.google.com/recaptcha", false));
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
    fn recognises_every_live_hh_applicant_menu_variant() {
        assert!(HH_SIGNED_IN_SELECTOR.contains("mainmenu_applicantProfile"));
        assert!(HH_SIGNED_IN_SELECTOR.contains("mainmenu_profileAndResumes"));
        assert!(HH_SIGNED_IN_SELECTOR.contains("profile-activator"));
    }
}
