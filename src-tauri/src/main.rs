// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod automation_worker;
mod network_probe;
mod tunnel_manager;

use automation_worker::{execute_candidate_action_safely, LocalActionRequest, LocalActionResult};
use network_probe::{evaluate_network_environment, NetworkEnvironmentStatus};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
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
    config: Option<TunnelConfig>,
    state: State<'_, AppState>,
) -> Result<TunnelStatusReport, String> {
    if let Some(cfg) = config {
        state.tunnel.update_config(cfg).await;
    }
    state.tunnel.set_running().await;
    Ok(state.tunnel.get_status().await)
}

#[tauri::command]
async fn stop_tunnel(state: State<'_, AppState>) -> Result<TunnelStatusReport, String> {
    state.tunnel.set_stopped().await;
    Ok(state.tunnel.get_status().await)
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
async fn desktop_native_fetch(request: NativeHttpRequest) -> Result<NativeHttpResponse, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20));

    let is_linkedin = request.url.contains("linkedin.com")
        || request.url.contains("licdn.com")
        || request.url.contains("lnkd.in");

    if is_linkedin {
        if let Ok(proxy) = reqwest::Proxy::all("http://127.0.0.1:10886") {
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

    let res = req.send().await.map_err(|e| format!("Network error: {}", e))?;

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
            get_desktop_environment_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenQareer desktop application");
}
