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
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Desktop Chrome signature. Platforms serve a stripped page to unknown agents.
const SESSION_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PAGE_READY_TIMEOUT: Duration = Duration::from_secs(25);
const PAGE_POLL_INTERVAL: Duration = Duration::from_millis(350);
/// Single-page platforms keep painting after `readyState` flips to complete.
const PAGE_SETTLE_DELAY: Duration = Duration::from_millis(900);
const EVAL_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionWindowRequest {
    pub platform: String,
    pub url: String,
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

/// One long-lived window per platform, so a second click focuses the window the
/// candidate already signed in to instead of starting a fresh session.
pub fn session_window_label(platform: &str) -> Option<&'static str> {
    match platform {
        "linkedin" => Some("connector-linkedin"),
        "hh" => Some("connector-hh"),
        _ => None,
    }
}

fn session_window_title(platform: &str) -> &'static str {
    match platform {
        "linkedin" => "Вход в LinkedIn — OpenQareer",
        _ => "Вход в hh.ru — OpenQareer",
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
}

fn validate(request: &SessionWindowRequest) -> Result<(&'static str, Url), String> {
    let label = session_window_label(&request.platform).ok_or("unsupported_platform")?;
    if !is_allowed_session_url(&request.platform, &request.url) {
        return Err("url_not_allowed".to_string());
    }
    let url = Url::parse(&request.url).map_err(|_| "url_not_allowed".to_string())?;
    Ok((label, url))
}

/// Opens (or refocuses) the platform's own sign-in window.
pub fn open_session_window(
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
    if let Some(existing) = app.get_webview_window(label) {
        if !existing.url().is_ok_and(|current| current == url) {
            let _ = existing.navigate(url);
        }
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return SessionWindowReport {
            opened: true,
            label: label.to_string(),
            reason: None,
        };
    }

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(session_window_title(&request.platform))
        .inner_size(1024.0, 820.0)
        .min_inner_size(620.0, 560.0)
        .user_agent(SESSION_USER_AGENT)
        .center()
        .resizable(true)
        .focused(true);

    if let Some(proxy) = proxy_url {
        builder = builder.proxy_url(proxy);
    }

    match builder.build() {
        Ok(_) => SessionWindowReport {
            opened: true,
            label: label.to_string(),
            reason: None,
        },
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
        .and_then(|label| app.get_webview_window(label))
        .is_some()
}

#[derive(Deserialize)]
struct DocumentState {
    ready: String,
    href: String,
}

/// `eval_with_callback` hands the JSON-encoded result to a `Fn` callback; the
/// oneshot sender has to survive being borrowed, hence the mutex.
async fn eval_json(window: &WebviewWindow, js: &str) -> Result<String, String> {
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

async fn read_document_state(window: &WebviewWindow) -> Result<DocumentState, String> {
    let raw = eval_json(
        window,
        "(function(){try{return {ready: document.readyState, href: location.href};}\
catch(e){return {ready: 'error', href: ''};}})()",
    )
    .await?;
    serde_json::from_str::<DocumentState>(&raw).map_err(|error| format!("eval_shape: {error}"))
}

/// Reads a page **inside the session the candidate signed in to**. A separate
/// HTTP client cannot do this: it does not share the webview's cookie jar.
pub async fn read_session_page(
    app: &AppHandle,
    request: &SessionWindowRequest,
) -> Result<SessionPageReport, String> {
    let (label, url) = validate(request)?;
    let window = app
        .get_webview_window(label)
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
        "(function(){try{return document.documentElement.outerHTML;}catch(e){return '';}})()",
    )
    .await?;
    let body = serde_json::from_str::<String>(&body_json)
        .map_err(|error| format!("body_shape: {error}"))?;
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
    }
}
