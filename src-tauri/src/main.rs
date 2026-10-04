// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod automation_worker;
mod connector_session;
mod linkedin_read_guard;
mod network_probe;
mod session_token_store;
mod sidecar_lifecycle;
mod tunnel_manager;

use automation_worker::{execute_candidate_action_safely, LocalActionRequest, LocalActionResult};
use connector_session::{
    bind_candidate_account, clear_linkedin_pool_profile, close_managed_session_window,
    close_orphaned_session_windows, close_session_window, inspect_session_page,
    inspect_session_page_for, is_managed_session_window_open, is_session_window_open,
    open_session_window, read_linkedin_pool_session_cookies, read_session_page,
    reset_session_window, resize_session_window, resize_session_window_for,
    should_route_through_tunnel, CandidateSessionAccount, PoolSessionCookie,
    SessionInspectionReport, SessionLayout, SessionPageReport, SessionWindowReport,
    SessionWindowRequest,
};
use network_probe::{evaluate_network_environment, NetworkEnvironmentStatus};
use serde::{Deserialize, Serialize};
use sidecar_lifecycle::sweep_leftover_runtimes;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, Url};
use tauri_plugin_fs::FsExt;
use tunnel_manager::{TunnelConfig, TunnelManager, TunnelStatusReport};

pub struct AppState {
    pub tunnel: Arc<TunnelManager>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopInfo {
    pub app_name: String,
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub is_desktop_companion: bool,
}

#[tauri::command]
async fn probe_network_status(
    custom_linkedin_url: Option<String>,
    custom_hh_url: Option<String>,
) -> NetworkEnvironmentStatus {
    evaluate_network_environment(
        custom_linkedin_url.as_deref(),
        custom_hh_url.as_deref(),
        Some(4),
    )
    .await
}

#[tauri::command]
async fn get_tunnel_status(state: State<'_, AppState>) -> Result<TunnelStatusReport, String> {
    Ok(state.tunnel.get_status().await)
}

#[tauri::command]
async fn start_tunnel(
    config: TunnelConfig,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TunnelStatusReport, String> {
    state.tunnel.start(&app, config).await
}

#[tauri::command]
async fn stop_tunnel(state: State<'_, AppState>) -> Result<TunnelStatusReport, String> {
    state.tunnel.stop().await
}

/// Opens a third-party link (vacancy board, source page) in the candidate's
/// default browser (B266). A WebView swallows `target="_blank"`, and only
/// http(s) may ever reach the OS: vacancy URLs come from external boards.
#[tauri::command]
fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = external_web_url(&url)?;
    #[allow(deprecated)]
    tauri_plugin_shell::ShellExt::shell(&app)
        .open(parsed.as_str(), None)
        .map_err(|error| format!("open_external_url: {error}"))
}

fn external_web_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "open_external_url: not a URL".to_string())?;
    match parsed.scheme() {
        "https" | "http" => Ok(parsed),
        _ => Err("open_external_url: only http(s) links open outside the app".to_string()),
    }
}

#[tauri::command]
async fn execute_local_action(request: LocalActionRequest) -> Result<LocalActionResult, String> {
    execute_candidate_action_safely(request).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeHttpResponse {
    pub status: u16,
    pub ok: bool,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
async fn desktop_native_fetch(
    request: NativeHttpRequest,
    state: State<'_, AppState>,
) -> Result<NativeHttpResponse, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20));

    // Routing through a proxy port nothing listens on turns every LinkedIn call
    // into a connect error, so ask the tunnel whether it is really up (B149).
    if should_route_through_tunnel(&request.url, state.tunnel.is_running().await) {
        let status = state.tunnel.get_status().await;
        let endpoint = format!("http://{}", status.local_http_endpoint);
        if let Ok(proxy) = reqwest::Proxy::all(&endpoint) {
            builder = builder.proxy(proxy);
        }
    }

    let client = builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);

    req = req
        .header("User-Agent", "OpenQareerDesktop/1.0.0 (macOS; Tauri)")
        .header("Origin", "https://openqareer.com")
        .header("Referer", "https://openqareer.com/");

    if let Some(headers) = request.headers {
        for (k, v) in headers {
            if !k.is_empty() {
                req = req.header(k, v);
            }
        }
    }

    if let Some(body) = request.body {
        req = req.body(body);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = res.status().as_u16();
    let ok = res.status().is_success();

    let mut response_headers = std::collections::HashMap::new();
    for (name, val) in res.headers().iter() {
        if let Ok(v_str) = val.to_str() {
            response_headers.insert(name.as_str().to_lowercase(), v_str.to_string());
        }
    }

    let body = res.text().await.unwrap_or_default();

    Ok(NativeHttpResponse {
        status,
        ok,
        headers: response_headers,
        body,
    })
}

#[tauri::command]
async fn print_resume(app: AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "print_resume: main webview unavailable".to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| unsafe {
                let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
                let print_info = objc2_app_kit::NSPrintInfo::sharedPrintInfo();
                let operation = view.printOperationWithPrintInfo(&print_info);
                let _ = sender.send(operation.runOperation());
            })
            .map_err(|error| format!("print_resume: {error}"))?;
        return receiver
            .await
            .map_err(|_| "print_resume: native print operation did not finish".to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("print_resume: native printing is unavailable on this platform".to_string())
    }
}

#[tauri::command]
async fn save_resume_pdf(app: AppHandle, path: String) -> Result<bool, String> {
    if !std::path::Path::new(&path).is_absolute() || !path.to_ascii_lowercase().ends_with(".pdf") {
        return Err("save_resume_pdf: choose an absolute PDF file path".to_string());
    }
    if !app.fs_scope().is_allowed(&path) {
        return Err("save_resume_pdf: choose the destination in the save dialog".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "save_resume_pdf: main webview unavailable".to_string())?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| unsafe {
                let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
                let print_info = objc2_app_kit::NSPrintInfo::sharedPrintInfo();
                let native_view: &objc2_app_kit::NSView = &*(view as *const _ as *const _);
                let destination = objc2_foundation::NSString::from_str(&path);
                let operation = objc2_app_kit::NSPrintOperation::PDFOperationWithView_insideRect_toPath_printInfo(
                    native_view,
                    native_view.bounds(),
                    &destination,
                    &print_info,
                );
                let _ = sender.send(operation.runOperation());
            })
            .map_err(|error| format!("save_resume_pdf: {error}"))?;
        return receiver
            .await
            .map_err(|_| "save_resume_pdf: PDF operation did not finish".to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("save_resume_pdf: native PDF export is unavailable on this platform".to_string())
    }
}

/// Opens the platform's own sign-in page in a window this application owns.
/// `window.open` is a silent no-op inside the Tauri webview, which is why the
/// previous flow claimed a window was open while nothing appeared (B149).
#[tauri::command]
async fn open_connector_session(
    app: AppHandle,
    request: SessionWindowRequest,
    state: State<'_, AppState>,
) -> Result<SessionWindowReport, String> {
    let proxy = if should_route_through_tunnel(&request.url, state.tunnel.is_running().await) {
        let status = state.tunnel.get_status().await;
        Url::parse(&format!("http://{}", status.local_http_endpoint)).ok()
    } else {
        None
    };
    Ok(open_session_window(&app, &request, proxy).await)
}

/// The session token as the app last saved it (B327): WebKit may lose its copy
/// on quit, this one is written synchronously.
#[tauri::command]
fn read_session_token(app: AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    session_token_store::read_token(&dir)
}

#[tauri::command]
fn write_session_token(token: Option<String>, app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "session_token_dir_failed".to_string())?;
    session_token_store::write_token(&dir, token.as_deref())
}

/// Exports LinkedIn cookies only from the explicitly named managed pool profile.
#[tauri::command]
fn export_pool_session(
    session_key: String,
    app: AppHandle,
) -> Result<Vec<PoolSessionCookie>, String> {
    read_linkedin_pool_session_cookies(&app, &session_key)
}

/// Removes the selected managed LinkedIn profile from this device after the
/// server has accepted its encrypted copy or the admin revoked the session.
#[tauri::command]
async fn clear_pool_session_profile(session_key: String, app: AppHandle) -> Result<(), String> {
    clear_linkedin_pool_profile(&app, &session_key).await
}

/// Whether the platform's window is still on screen.
#[tauri::command]
fn is_connector_session_open(
    app: AppHandle,
    platform: String,
    session_key: Option<String>,
) -> bool {
    if session_key.is_some() {
        is_managed_session_window_open(&app, &platform, session_key.as_deref())
    } else {
        is_session_window_open(&app, &platform)
    }
}

#[tauri::command]
fn close_connector_session(app: AppHandle, platform: String, session_key: Option<String>) -> bool {
    if session_key.is_some() {
        close_managed_session_window(&app, &platform, session_key.as_deref())
    } else {
        close_session_window(&app, &platform)
    }
}

/// Binds the candidate's sign-in windows to the signed-in OpenQareer account
/// (a SHA-256 hex digest), or unbinds them on sign-out (INC-039).
#[tauri::command]
fn bind_connector_account(app: AppHandle, account_key: Option<String>) -> Result<bool, String> {
    bind_candidate_account(&app, account_key)
}

#[tauri::command]
async fn reset_connector_session(app: AppHandle, platform: String) -> bool {
    reset_session_window(&app, &platform).await
}

#[tauri::command]
fn resize_connector_session(
    app: AppHandle,
    platform: String,
    layout: SessionLayout,
    session_key: Option<String>,
) -> bool {
    if session_key.is_some() {
        resize_session_window_for(&app, &platform, session_key.as_deref(), layout)
    } else {
        resize_session_window(&app, &platform, layout)
    }
}

/// Reads a page inside the candidate's own signed-in session window.
#[tauri::command]
async fn read_connector_session_page(
    app: AppHandle,
    request: SessionWindowRequest,
) -> Result<SessionPageReport, String> {
    read_session_page(&app, &request).await
}

/// Inspects the current page without redirecting an in-progress login flow.
#[tauri::command]
async fn inspect_connector_session_page(
    app: AppHandle,
    platform: String,
    session_key: Option<String>,
) -> Result<SessionInspectionReport, String> {
    if session_key.is_some() {
        inspect_session_page_for(&app, &platform, session_key.as_deref()).await
    } else {
        inspect_session_page(&app, &platform).await
    }
}

#[tauri::command]
fn get_desktop_environment_info() -> DesktopInfo {
    DesktopInfo {
        app_name: "OpenQareer Desktop".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        is_desktop_companion: true,
    }
}

fn is_tunnel_cleanup_event(event: &tauri::RunEvent) -> bool {
    matches!(
        event,
        tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
    )
}

/// Signals that must take the tunnel down with the application.
///
/// None of these produce a `RunEvent`, so without this the sidecar outlives an
/// installer replacing the running `.app`, a `killall`, or a logout that times
/// out — leaving a proxy listening on a route the candidate thinks is closed
/// (PRB-011). `SIGKILL` cannot be caught here; the startup sweep covers it.
#[cfg(unix)]
fn install_signal_shutdown(app: &tauri::App) {
    use tokio::signal::unix::{signal, SignalKind};

    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let listen = |kind: SignalKind| {
            signal(kind).inspect_err(|error| {
                eprintln!("tunnel_signal_handler_unavailable: {error}");
            })
        };
        let (Ok(mut term), Ok(mut interrupt), Ok(mut hangup)) = (
            listen(SignalKind::terminate()),
            listen(SignalKind::interrupt()),
            listen(SignalKind::hangup()),
        ) else {
            return;
        };
        tokio::select! {
            _ = term.recv() => {},
            _ = interrupt.recv() => {},
            _ = hangup.recv() => {},
        }
        let tunnel = handle.state::<AppState>().tunnel.clone();
        let _ = tunnel.stop().await;
        handle.exit(0);
    });
}

fn main() {
    let tunnel = TunnelManager::new();
    let app_state = AppState { tunnel };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // A reload of our own page destroys the interface that owned the
        // platform sign-in window, but not the window: it stayed on screen with
        // no control left that could close it (owner report, 2026-08-26).
        .on_page_load(|webview, _payload| {
            close_orphaned_session_windows(&webview.app_handle().clone(), webview.label());
        })
        .manage(app_state)
        .manage(CandidateSessionAccount::default())
        .manage(linkedin_read_guard::LinkedInReadGuardState::default())
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            probe_network_status,
            get_tunnel_status,
            start_tunnel,
            stop_tunnel,
            execute_local_action,
            desktop_native_fetch,
            print_resume,
            save_resume_pdf,
            bind_connector_account,
            open_connector_session,
            export_pool_session,
            clear_pool_session_profile,
            is_connector_session_open,
            close_connector_session,
            reset_connector_session,
            resize_connector_session,
            read_connector_session_page,
            inspect_connector_session_page,
            get_desktop_environment_info,
            read_session_token,
            write_session_token,
        ])
        .build(tauri::generate_context!())
        .expect("error while building OpenQareer desktop application");

    #[cfg(unix)]
    install_signal_shutdown(&app);

    // Whatever the previous instance could not clean up after an uncatchable
    // kill: an orphaned sing-box still serving a route, and its runtime config
    // holding the SSH private key (PRB-011).
    if let Ok(dir) = app.path().app_config_dir() {
        tauri::async_runtime::block_on(async move {
            for action in sweep_leftover_runtimes(&dir).await {
                eprintln!("tunnel_startup_sweep: {action}");
            }
        });
    }

    app.run(|app_handle, event| {
        if !is_tunnel_cleanup_event(&event) {
            return;
        }
        let tunnel = app_handle.state::<AppState>().tunnel.clone();
        tauri::async_runtime::block_on(async move {
            let _ = tunnel.stop().await;
        });
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn external_links_are_web_only() {
        assert!(super::external_web_url("https://jobs.example.com/1").is_ok());
        assert!(super::external_web_url("http://jobs.example.com/1").is_ok());
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "smb://h/s",
            "vscode://x",
            "nope",
        ] {
            assert!(
                super::external_web_url(bad).is_err(),
                "{bad} must be refused"
            );
        }
    }

    use super::*;

    #[test]
    fn application_exit_is_a_tunnel_cleanup_event() {
        assert!(is_tunnel_cleanup_event(&tauri::RunEvent::Exit));
    }
}
