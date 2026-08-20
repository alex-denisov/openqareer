use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use tokio::{net::TcpStream, sync::Mutex};

const START_TIMEOUT: Duration = Duration::from_secs(8);
const START_POLL: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfig {
    pub remote_server: String,
    pub remote_port: u16,
    pub ssh_user: String,
    pub ssh_private_key_base64: String,
    pub ssh_host_key_base64: String,
    pub proxy_username: String,
    pub proxy_password: String,
    pub local_socks_port: u16,
    pub local_http_port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelState {
    Idle,
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelStatusReport {
    pub state: TunnelState,
    pub local_socks_endpoint: String,
    pub local_http_endpoint: String,
    pub active_protocol: String,
    pub split_proxied_domains: Vec<String>,
    pub split_direct_domains: Vec<String>,
    pub started_at: Option<String>,
    pub error_message: Option<String>,
}

fn valid_host(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

pub fn validate_tunnel_config(config: &TunnelConfig) -> Result<(), String> {
    if !valid_host(&config.remote_server) {
        return Err("tunnel_host_invalid".into());
    }
    if config.remote_port == 0
        || config.local_socks_port < 1024
        || config.local_http_port < 1024
        || config.local_socks_port == config.local_http_port
    {
        return Err("tunnel_port_invalid".into());
    }
    if config.ssh_user.len() < 3
        || config.proxy_username.len() < 12
        || config.proxy_password.len() < 32
    {
        return Err("tunnel_ssh_invalid".into());
    }
    let key = BASE64
        .decode(&config.ssh_private_key_base64)
        .map_err(|_| "tunnel_ssh_key_invalid".to_string())?;
    let key_text = String::from_utf8(key).map_err(|_| "tunnel_ssh_key_invalid".to_string())?;
    if !key_text.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        return Err("tunnel_ssh_key_invalid".into());
    }
    let host_key = BASE64
        .decode(&config.ssh_host_key_base64)
        .map_err(|_| "tunnel_ssh_host_key_invalid".to_string())?;
    if host_key.len() < 40 {
        return Err("tunnel_ssh_host_key_invalid".into());
    }
    Ok(())
}

pub fn generate_singbox_split_config(c: &TunnelConfig) -> Result<serde_json::Value, String> {
    let private_key = String::from_utf8(
        BASE64
            .decode(&c.ssh_private_key_base64)
            .map_err(|_| "tunnel_ssh_key_invalid".to_string())?,
    )
    .map_err(|_| "tunnel_ssh_key_invalid".to_string())?;
    let host_key = String::from_utf8(
        BASE64
            .decode(&c.ssh_host_key_base64)
            .map_err(|_| "tunnel_ssh_host_key_invalid".to_string())?,
    )
    .map_err(|_| "tunnel_ssh_host_key_invalid".to_string())?;
    Ok(json!({
      "log":{"level":"warn","timestamp":true},
      "inbounds":[
        {"type":"socks","tag":"socks-in","listen":"127.0.0.1","listen_port":c.local_socks_port},
        {"type":"http","tag":"http-in","listen":"127.0.0.1","listen_port":c.local_http_port}
      ],
      "outbounds":[
        {"type":"ssh","tag":"ssh-eu-out","server":c.remote_server,"server_port":c.remote_port,"user":c.ssh_user,
         "private_key":private_key,"host_key":[host_key],"host_key_algorithms":["ssh-ed25519"]},
        {"type":"http","tag":"linkedin-proxy-out","server":"127.0.0.1","server_port":18081,
         "username":c.proxy_username,"password":c.proxy_password,"detour":"ssh-eu-out"},
        {"type":"direct","tag":"direct-out"},{"type":"block","tag":"block-out"}
      ],
      "route":{"rules":[
        {"domain_suffix":["linkedin.com","licdn.com","linkedin.cn","lnkd.in"],"outbound":"linkedin-proxy-out"},
        {"domain_suffix":["hh.ru","headhunter.ru","openqareer.com"],"outbound":"direct-out"},
        {"ip_is_private":true,"outbound":"direct-out"}
      ],"final":"block-out","auto_detect_interface":true}
    }))
}

pub struct TunnelManager {
    config: Mutex<Option<TunnelConfig>>,
    state: Mutex<TunnelState>,
    child: Mutex<Option<CommandChild>>,
    runtime_config_path: Mutex<Option<PathBuf>>,
    started_at: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
}

impl TunnelManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            config: Mutex::new(None),
            state: Mutex::new(TunnelState::Idle),
            child: Mutex::new(None),
            runtime_config_path: Mutex::new(None),
            started_at: Mutex::new(None),
            last_error: Mutex::new(None),
        })
    }

    pub async fn get_status(&self) -> TunnelStatusReport {
        let config = self.config.lock().await.clone();
        let mut state = self.state.lock().await.clone();
        let http_port = config.as_ref().map(|c| c.local_http_port).unwrap_or(10_886);
        if state == TunnelState::Running
            && TcpStream::connect(("127.0.0.1", http_port)).await.is_err()
        {
            state = TunnelState::Failed;
            *self.state.lock().await = state.clone();
            *self.last_error.lock().await = Some("tunnel_process_not_listening".into());
        }
        let socks_port = config
            .as_ref()
            .map(|c| c.local_socks_port)
            .unwrap_or(10_885);
        TunnelStatusReport {
            state,
            local_socks_endpoint: format!("127.0.0.1:{socks_port}"),
            local_http_endpoint: format!("127.0.0.1:{http_port}"),
            active_protocol: "SSH restricted egress".into(),
            split_proxied_domains: vec![
                "linkedin.com".into(),
                "licdn.com".into(),
                "lnkd.in".into(),
            ],
            split_direct_domains: vec!["hh.ru".into(), "openqareer.com".into()],
            started_at: self.started_at.lock().await.clone(),
            error_message: self.last_error.lock().await.clone(),
        }
    }

    async fn fail(&self, reason: String) -> Result<TunnelStatusReport, String> {
        if let Some(child) = self.child.lock().await.take() {
            let _ = child.kill();
        }
        if let Some(path) = self.runtime_config_path.lock().await.take() {
            let _ = tokio::fs::remove_file(path).await;
        }
        *self.state.lock().await = TunnelState::Failed;
        *self.started_at.lock().await = None;
        *self.last_error.lock().await = Some(reason.clone());
        Err(reason)
    }

    pub async fn start(
        &self,
        app: &AppHandle,
        config: TunnelConfig,
    ) -> Result<TunnelStatusReport, String> {
        validate_tunnel_config(&config)?;
        self.stop().await?;
        *self.config.lock().await = Some(config.clone());
        *self.state.lock().await = TunnelState::Starting;
        *self.last_error.lock().await = None;
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| format!("tunnel_config_dir_unavailable: {e}"))?;
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("tunnel_config_dir_failed: {e}"))?;
        let path = dir.join(format!("tunnel-{}.json", std::process::id()));
        let bytes = serde_json::to_vec_pretty(&generate_singbox_split_config(&config)?)
            .map_err(|e| format!("tunnel_config_encode_failed: {e}"))?;
        tokio::fs::write(&path, bytes)
            .await
            .map_err(|e| format!("tunnel_config_write_failed: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .await
                .map_err(|e| format!("tunnel_config_permissions_failed: {e}"))?;
        }
        *self.runtime_config_path.lock().await = Some(path.clone());
        let (_events, child) = app
            .shell()
            .sidecar("sing-box")
            .map_err(|e| format!("tunnel_sidecar_unavailable: {e}"))?
            .args(["run", "-c", path.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| format!("tunnel_sidecar_start_failed: {e}"))?;
        *self.child.lock().await = Some(child);
        let deadline = tokio::time::Instant::now() + START_TIMEOUT;
        while TcpStream::connect(("127.0.0.1", config.local_http_port))
            .await
            .is_err()
        {
            if tokio::time::Instant::now() >= deadline {
                return self.fail("tunnel_proxy_start_timeout".into()).await;
            }
            tokio::time::sleep(START_POLL).await;
        }
        let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{}", config.local_http_port))
            .map_err(|e| format!("tunnel_proxy_invalid: {e}"))?;
        let client = reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("tunnel_probe_client_failed: {e}"))?;
        if let Err(error) = client.head("https://www.linkedin.com/").send().await {
            return self
                .fail(format!("tunnel_linkedin_probe_failed: {error}"))
                .await;
        }
        *self.state.lock().await = TunnelState::Running;
        *self.started_at.lock().await = Some(Utc::now().to_rfc3339());
        Ok(self.get_status().await)
    }

    pub async fn stop(&self) -> Result<TunnelStatusReport, String> {
        if let Some(child) = self.child.lock().await.take() {
            let _ = child.kill();
        }
        if let Some(path) = self.runtime_config_path.lock().await.take() {
            let _ = tokio::fs::remove_file(path).await;
        }
        *self.state.lock().await = TunnelState::Stopped;
        *self.started_at.lock().await = None;
        Ok(self.get_status().await)
    }

    pub async fn is_running(&self) -> bool {
        self.get_status().await.state == TunnelState::Running
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn valid() -> TunnelConfig {
        TunnelConfig {
            remote_server: "openqareer.com".into(),
            remote_port: 443,
            ssh_user: "openqareer-tunnel".into(),
            ssh_private_key_base64: BASE64.encode(
                "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n",
            ),
            ssh_host_key_base64: BASE64
                .encode("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticHostKeyForTests"),
            proxy_username: "synthetic_user".into(),
            proxy_password: "synthetic-password-that-is-long-enough".into(),
            local_socks_port: 10_885,
            local_http_port: 10_886,
        }
    }
    #[test]
    fn validates_runtime_configuration() {
        assert!(validate_tunnel_config(&valid()).is_ok());
        let mut c = valid();
        c.ssh_private_key_base64 = "bad".into();
        assert_eq!(
            validate_tunnel_config(&c),
            Err("tunnel_ssh_key_invalid".into())
        );
    }
    #[test]
    fn generates_restricted_ssh_split_route() {
        let j = generate_singbox_split_config(&valid()).expect("config");
        assert_eq!(j["outbounds"][0]["type"], "ssh");
        assert_eq!(j["outbounds"][1]["type"], "http");
        assert_eq!(j["outbounds"][1]["detour"], "ssh-eu-out");
        assert_eq!(j["route"]["rules"][1]["outbound"], "direct-out");
        assert!(j["inbounds"][0].get("sniff").is_none());
        assert!(j["inbounds"][1].get("sniff").is_none());
    }
    #[tokio::test]
    async fn never_reports_running_without_a_live_proxy() {
        let m = TunnelManager::new();
        *m.config.lock().await = Some(valid());
        *m.state.lock().await = TunnelState::Running;
        let s = m.get_status().await;
        assert_eq!(s.state, TunnelState::Failed);
    }
}
