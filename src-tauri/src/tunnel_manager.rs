use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelConfig {
    pub remote_server: String,
    pub remote_port: u16,
    pub uuid: String,
    pub sni_mask: String,
    pub reality_public_key: String,
    pub reality_short_id: String,
    pub local_socks_port: u16,
    pub local_http_port: u16,
}

impl Default for TunnelConfig {
    fn default() -> Self {
        Self {
            remote_server: "openqareer.com".to_string(),
            remote_port: 443,
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            sni_mask: "www.microsoft.com".to_string(),
            reality_public_key: "default-reality-public-key".to_string(),
            reality_short_id: "0123456789abcdef".to_string(),
            local_socks_port: 10885,
            local_http_port: 10886,
        }
    }
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

#[allow(dead_code)]
pub fn generate_singbox_split_config(config: &TunnelConfig) -> serde_json::Value {
    json!({
        "log": {
            "level": "warn",
            "timestamp": true
        },
        "inbounds": [
            {
                "type": "socks",
                "tag": "socks-in",
                "listen": "127.0.0.1",
                "listen_port": config.local_socks_port,
                "sniff": true,
                "sniff_override_destination": false
            },
            {
                "type": "http",
                "tag": "http-in",
                "listen": "127.0.0.1",
                "listen_port": config.local_http_port,
                "sniff": true
            }
        ],
        "outbounds": [
            {
                "type": "vless",
                "tag": "vless-reality-out",
                "server": config.remote_server,
                "server_port": config.remote_port,
                "uuid": config.uuid,
                "flow": "xtls-rprx-vision",
                "tls": {
                    "enabled": true,
                    "server_name": config.sni_mask,
                    "utls": {
                        "enabled": true,
                        "fingerprint": "chrome"
                    },
                    "reality": {
                        "enabled": true,
                        "public_key": config.reality_public_key,
                        "short_id": config.reality_short_id
                    }
                }
            },
            {
                "type": "direct",
                "tag": "direct-out"
            },
            {
                "type": "block",
                "tag": "block-out"
            }
        ],
        "route": {
            "rules": [
                {
                    "domain_suffix": [
                        "linkedin.com",
                        "licdn.com",
                        "linkedin.cn",
                        "lnkd.in"
                    ],
                    "outbound": "vless-reality-out"
                },
                {
                    "domain_suffix": [
                        "hh.ru",
                        "headhunter.ru",
                        "openqareer.com"
                    ],
                    "outbound": "direct-out"
                },
                {
                    "ip_is_private": true,
                    "outbound": "direct-out"
                }
            ],
            "final": "direct-out",
            "auto_detect_interface": true
        }
    })
}

pub struct TunnelManager {
    config: Mutex<TunnelConfig>,
    state: Mutex<TunnelState>,
    started_at: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
}

impl TunnelManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            config: Mutex::new(TunnelConfig::default()),
            state: Mutex::new(TunnelState::Idle),
            started_at: Mutex::new(None),
            last_error: Mutex::new(None),
        })
    }

    pub async fn get_status(&self) -> TunnelStatusReport {
        let config = self.config.lock().await;
        let state = self.state.lock().await.clone();
        let started_at = self.started_at.lock().await.clone();
        let error_message = self.last_error.lock().await.clone();

        TunnelStatusReport {
            state,
            local_socks_endpoint: format!("127.0.0.1:{}", config.local_socks_port),
            local_http_endpoint: format!("127.0.0.1:{}", config.local_http_port),
            active_protocol: "VLESS-Reality".to_string(),
            split_proxied_domains: vec![
                "linkedin.com".to_string(),
                "licdn.com".to_string(),
                "lnkd.in".to_string(),
            ],
            split_direct_domains: vec![
                "hh.ru".to_string(),
                "openqareer.com".to_string(),
            ],
            started_at,
            error_message,
        }
    }

    pub async fn update_config(&self, new_config: TunnelConfig) {
        let mut cfg = self.config.lock().await;
        *cfg = new_config;
    }

    pub async fn set_running(&self) {
        let mut state = self.state.lock().await;
        *state = TunnelState::Running;
        let mut started = self.started_at.lock().await;
        *started = Some(Utc::now().to_rfc3339());
        let mut err = self.last_error.lock().await;
        *err = None;
    }

    pub async fn set_stopped(&self) {
        let mut state = self.state.lock().await;
        *state = TunnelState::Stopped;
        let mut started = self.started_at.lock().await;
        *started = None;
    }

    pub async fn set_error(&self, error: String) {
        let mut state = self.state.lock().await;
        *state = TunnelState::Failed;
        let mut err = self.last_error.lock().await;
        *err = Some(error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_singbox_split_config_structure() {
        let config = TunnelConfig {
            remote_server: "test.openqareer.com".to_string(),
            remote_port: 8443,
            uuid: "11111111-2222-3333-4444-555555555555".to_string(),
            sni_mask: "gateway.icloud.com".to_string(),
            reality_public_key: "sample-pub-key".to_string(),
            reality_short_id: "abcdef01".to_string(),
            local_socks_port: 10885,
            local_http_port: 10886,
        };

        let json_config = generate_singbox_split_config(&config);

        // Assert inbounds
        let inbounds = json_config["inbounds"].as_array().expect("inbounds array");
        assert_eq!(inbounds.len(), 2);
        assert_eq!(inbounds[0]["type"], "socks");
        assert_eq!(inbounds[0]["listen_port"], 10885);
        assert_eq!(inbounds[1]["type"], "http");
        assert_eq!(inbounds[1]["listen_port"], 10886);

        // Assert outbounds
        let outbounds = json_config["outbounds"].as_array().expect("outbounds array");
        assert!(outbounds.iter().any(|o| o["tag"] == "vless-reality-out"));
        assert!(outbounds.iter().any(|o| o["tag"] == "direct-out"));

        // Assert routing rules
        let rules = json_config["route"]["rules"].as_array().expect("route rules");
        let linkedin_rule = rules.iter().find(|r| {
            r["domain_suffix"]
                .as_array()
                .map_or(false, |domains| domains.iter().any(|d| d == "linkedin.com"))
        }).expect("LinkedIn routing rule must exist");
        assert_eq!(linkedin_rule["outbound"], "vless-reality-out");

        let hh_rule = rules.iter().find(|r| {
            r["domain_suffix"]
                .as_array()
                .map_or(false, |domains| domains.iter().any(|d| d == "hh.ru"))
        }).expect("hh.ru routing rule must exist");
        assert_eq!(hh_rule["outbound"], "direct-out");
    }

    #[tokio::test]
    async fn test_tunnel_manager_lifecycle() {
        let manager = TunnelManager::new();
        let status = manager.get_status().await;
        assert_eq!(status.state, TunnelState::Idle);

        manager.set_running().await;
        let status_running = manager.get_status().await;
        assert_eq!(status_running.state, TunnelState::Running);
        assert!(status_running.started_at.is_some());

        manager.set_stopped().await;
        let status_stopped = manager.get_status().await;
        assert_eq!(status_stopped.state, TunnelState::Stopped);
        assert!(status_stopped.started_at.is_none());
    }
}
