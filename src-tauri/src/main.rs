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
            get_desktop_environment_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenQareer desktop application");
}
