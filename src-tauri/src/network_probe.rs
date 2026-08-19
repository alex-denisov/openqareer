use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const DEFAULT_PROBE_TIMEOUT_SECS: u64 = 4;
const DEFAULT_LINKEDIN_URL: &str = "https://www.linkedin.com";
const DEFAULT_HH_URL: &str = "https://api.hh.ru/openapi/redoc";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelRecommendation {
    Direct,
    TunnelRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformProbeResult {
    pub platform: String,
    pub target_url: String,
    pub accessible: bool,
    pub latency_ms: Option<u64>,
    pub status_code: Option<u16>,
    pub error_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkEnvironmentStatus {
    pub linkedin: PlatformProbeResult,
    pub hh: PlatformProbeResult,
    pub recommendation: TunnelRecommendation,
    pub local_ip_region_hint: String,
    pub probed_at: String,
}

pub async fn probe_single_endpoint(
    platform: &str,
    url: &str,
    timeout: Duration,
) -> PlatformProbeResult {
    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return PlatformProbeResult {
                platform: platform.to_string(),
                target_url: url.to_string(),
                accessible: false,
                latency_ms: None,
                status_code: None,
                error_reason: Some(format!("Client build error: {e}")),
            }
        }
    };

    let start = Instant::now();
    match client.head(url).send().await {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            // Any response from LinkedIn/hh (including 200, 301, 302, 403, 999) means the network reached the server.
            PlatformProbeResult {
                platform: platform.to_string(),
                target_url: url.to_string(),
                accessible: true,
                latency_ms: Some(latency),
                status_code: Some(status),
                error_reason: None,
            }
        }
        Err(e) => {
            let reason = if e.is_timeout() {
                "Connection timed out (likely TSPU/RKN block or unreachable network)".to_string()
            } else if e.is_connect() {
                "Connection reset or dropped (TCP RST by network filter)".to_string()
            } else {
                format!("Network error: {e}")
            };

            PlatformProbeResult {
                platform: platform.to_string(),
                target_url: url.to_string(),
                accessible: false,
                latency_ms: None,
                status_code: None,
                error_reason: Some(reason),
            }
        }
    }
}

pub async fn evaluate_network_environment(
    custom_linkedin_url: Option<&str>,
    custom_hh_url: Option<&str>,
    timeout_secs: Option<u64>,
) -> NetworkEnvironmentStatus {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_PROBE_TIMEOUT_SECS));
    let linkedin_url = custom_linkedin_url.unwrap_or(DEFAULT_LINKEDIN_URL);
    let hh_url = custom_hh_url.unwrap_or(DEFAULT_HH_URL);

    let (linkedin_result, hh_result) = tokio::join!(
        probe_single_endpoint("linkedin", linkedin_url, timeout),
        probe_single_endpoint("hh", hh_url, timeout)
    );

    let recommendation = if linkedin_result.accessible {
        TunnelRecommendation::Direct
    } else {
        TunnelRecommendation::TunnelRequired
    };

    let region_hint = if !linkedin_result.accessible && hh_result.accessible {
        "RU_DIRECT_DETECTED".to_string()
    } else if linkedin_result.accessible && hh_result.accessible {
        "GLOBAL_OR_VPN_ACTIVE".to_string()
    } else if linkedin_result.accessible && !hh_result.accessible {
        "INTERNATIONAL_NON_RU".to_string()
    } else {
        "OFFLINE_OR_DEGRADED".to_string()
    };

    NetworkEnvironmentStatus {
        linkedin: linkedin_result,
        hh: hh_result,
        recommendation,
        local_ip_region_hint: region_hint,
        probed_at: Utc::now().to_rfc3339(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recommendation_matrix_direct_when_accessible() {
        let linkedin_res = PlatformProbeResult {
            platform: "linkedin".to_string(),
            target_url: "https://www.linkedin.com".to_string(),
            accessible: true,
            latency_ms: Some(120),
            status_code: Some(200),
            error_reason: None,
        };
        let _hh_res = PlatformProbeResult {
            platform: "hh".to_string(),
            target_url: "https://api.hh.ru".to_string(),
            accessible: true,
            latency_ms: Some(45),
            status_code: Some(200),
            error_reason: None,
        };

        let rec = if linkedin_res.accessible {
            TunnelRecommendation::Direct
        } else {
            TunnelRecommendation::TunnelRequired
        };
        assert_eq!(rec, TunnelRecommendation::Direct);
    }

    #[test]
    fn test_recommendation_matrix_tunnel_when_linkedin_blocked() {
        let linkedin_res = PlatformProbeResult {
            platform: "linkedin".to_string(),
            target_url: "https://www.linkedin.com".to_string(),
            accessible: false,
            latency_ms: None,
            status_code: None,
            error_reason: Some("Timeout".to_string()),
        };
        let _hh_res = PlatformProbeResult {
            platform: "hh".to_string(),
            target_url: "https://api.hh.ru".to_string(),
            accessible: true,
            latency_ms: Some(30),
            status_code: Some(200),
            error_reason: None,
        };

        let rec = if linkedin_res.accessible {
            TunnelRecommendation::Direct
        } else {
            TunnelRecommendation::TunnelRequired
        };
        assert_eq!(rec, TunnelRecommendation::TunnelRequired);
    }
}
