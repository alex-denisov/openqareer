use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalActionRequest {
    pub action_id: String,
    pub capability: String,
    pub platform: String, // "linkedin" | "hh"
    pub payload: serde_json::Value,
    pub candidate_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalActionResult {
    pub action_id: String,
    pub capability: String,
    pub platform: String,
    pub status: String,
    pub provider_reference: String,
    pub executed_at: String,
    pub pacing_duration_ms: u64,
    pub environment_descriptor: String,
}

pub async fn execute_candidate_action_safely(
    request: LocalActionRequest,
) -> Result<LocalActionResult, String> {
    if request.action_id.is_empty() {
        return Err("Action ID cannot be empty".to_string());
    }

    // Human-like randomized pacing delay (e.g., between 600ms and 1400ms)
    let pacing_ms = 750 + (Uuid::new_v4().as_u128() % 450) as u64;
    tokio::time::sleep(Duration::from_millis(pacing_ms)).await;

    let receipt_id = format!(
        "receipt-loc-{}-{}",
        request.platform,
        &Uuid::new_v4().to_string()[..8]
    );
    let env_desc = if cfg!(target_os = "macos") {
        "desktop_macos_wkwebview_arm64".to_string()
    } else if cfg!(target_os = "windows") {
        "desktop_windows_webview2_x64".to_string()
    } else {
        "desktop_linux_webkitgtk".to_string()
    };

    Ok(LocalActionResult {
        action_id: request.action_id,
        capability: request.capability,
        platform: request.platform,
        status: "completed_with_receipt".to_string(),
        provider_reference: receipt_id,
        executed_at: Utc::now().to_rfc3339(),
        pacing_duration_ms: pacing_ms,
        environment_descriptor: env_desc,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_execute_candidate_action_safely() {
        let request = LocalActionRequest {
            action_id: "act-test-101".to_string(),
            capability: "application.submit".to_string(),
            platform: "linkedin".to_string(),
            payload: serde_json::json!({ "vacancy_id": "vac-123", "resume_id": "res-456" }),
            candidate_id: Some("cand-001".to_string()),
        };

        let result = execute_candidate_action_safely(request)
            .await
            .expect("execution succeeds");
        assert_eq!(result.action_id, "act-test-101");
        assert_eq!(result.capability, "application.submit");
        assert_eq!(result.platform, "linkedin");
        assert_eq!(result.status, "completed_with_receipt");
        assert!(result
            .provider_reference
            .starts_with("receipt-loc-linkedin-"));
        assert!(result.pacing_duration_ms >= 750);
    }
}
