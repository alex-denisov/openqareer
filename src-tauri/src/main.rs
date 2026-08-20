// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod automation_worker;
mod connector_session;
mod network_probe;
mod tunnel_manager;

use automation_worker::{execute_candidate_action_safely, LocalActionRequest, LocalActionResult};
use connector_session::{
    close_session_window, is_session_window_open, open_session_window, read_session_page,
    resize_session_window, should_route_through_tunnel, SessionLayout, SessionPageReport,
    SessionWindowReport, SessionWindowRequest,
};
use network_probe::{evaluate_network_environment, NetworkEnvironmentStatus};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State, Url};
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
    Ok(open_session_window(&app, &request, proxy))
}

/// Whether the platform's window is still on screen.
#[tauri::command]
fn is_connector_session_open(app: AppHandle, platform: String) -> bool {
    is_session_window_open(&app, &platform)
}

#[tauri::command]
fn close_connector_session(app: AppHandle, platform: String) -> bool {
    close_session_window(&app, &platform)
}

#[tauri::command]
fn resize_connector_session(app: AppHandle, platform: String, layout: SessionLayout) -> bool {
    resize_session_window(&app, &platform, layout)
}

/// Reads a page inside the candidate's own signed-in session window.
#[tauri::command]
async fn read_connector_session_page(
    app: AppHandle,
    request: SessionWindowRequest,
) -> Result<SessionPageReport, String> {
    read_session_page(&app, &request).await
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

fn main() {
    let tunnel = TunnelManager::new();
    let app_state = AppState { tunnel };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            probe_network_status,
            get_tunnel_status,
            start_tunnel,
            stop_tunnel,
            execute_local_action,
            desktop_native_fetch,
            open_connector_session,
            is_connector_session_open,
            close_connector_session,
            resize_connector_session,
            read_connector_session_page,
            get_desktop_environment_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenQareer desktop application");
}
