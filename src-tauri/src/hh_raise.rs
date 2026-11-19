//! B699: raising the candidate's resume on hh.ru («Поднять в поиске»), in the
//! candidate's own hh.ru session window and only for a task the server handed
//! out. The web view passes the resume id; it is validated here and put into
//! the address, so page script can never be supplied from outside. The page
//! script (`hh_raise_page.js`) reads no views or invitations: it classifies the
//! page and presses one button. Anything unexpected is reported, never retried.

use crate::connector_session::{
    eval_json, is_allowed_session_url, is_transient_eval_error, read_session_page,
    session_window_label, SessionWindowRequest, HH_SIGNED_IN_SELECTOR,
};
use crate::hh_apply::RunningGuard;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const RESUME_ID_MAX: usize = 64;
const STEP_POLL: Duration = Duration::from_millis(500);
/// The page draws, the button is pressed and hh.ru answers within this time.
const RAISE_WAIT: Duration = Duration::from_secs(30);
const PAGE_SCRIPT: &str = include_str!("hh_raise_page.js");
const SIGNED_IN_PLACEHOLDER: &str = "__SIGNED_IN_SELECTOR__";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HhRaiseRequest {
    pub resume_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HhRaiseReport {
    /// `ok`, `captcha`, `logged_out`, `foreign_page`, `too_early`, `error`,
    /// or `busy` (the window is taken by a response; nothing was done).
    pub outcome: String,
}

impl HhRaiseReport {
    fn of(outcome: &str) -> Self {
        Self {
            outcome: outcome.to_string(),
        }
    }
}

#[derive(Deserialize)]
struct StepResult {
    code: String,
}

/// hh.ru resume ids are hex hashes (or plain numbers): nothing else gets near a script or an address.
pub fn validate_request(request: &HhRaiseRequest) -> Result<(), String> {
    let id = &request.resume_id;
    if id.is_empty() || id.len() > RESUME_ID_MAX || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("resume_id_invalid".into());
    }
    Ok(())
}

pub fn resume_url(resume_id: &str) -> String {
    format!("https://hh.ru/resume/{resume_id}")
}

/// The page script with the signed-in marker embedded as a JSON string literal.
pub fn page_script() -> String {
    let marker = serde_json::to_string(HH_SIGNED_IN_SELECTOR).unwrap_or_else(|_| "\"\"".into());
    PAGE_SCRIPT.replace(SIGNED_IN_PLACEHOLDER, &marker)
}

/// Maps the last page answer to one of the outcomes the server accepts.
pub fn report_for(code: &str) -> HhRaiseReport {
    match code {
        "ok" | "captcha" | "logged_out" | "foreign_page" | "too_early" => HhRaiseReport::of(code),
        _ => HhRaiseReport::of("error"),
    }
}

async fn step(window: &tauri::Webview, script: &str) -> Result<String, String> {
    let raw = eval_json(window, script).await?;
    serde_json::from_str::<StepResult>(&raw)
        .map(|result| result.code)
        .map_err(|_| "step_shape".to_string())
}

/// Polls the page script until it answers something other than `waiting`.
async fn wait_for_answer(window: &tauri::Webview, script: &str) -> String {
    let deadline = tokio::time::Instant::now() + RAISE_WAIT;
    loop {
        match step(window, script).await {
            Ok(code) if code != "waiting" => return code,
            Err(error) if !is_transient_eval_error(&error) => return "script_error".into(),
            _ => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return "timeout".into();
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

fn on_hh(window: &tauri::Webview) -> bool {
    window
        .url()
        .is_ok_and(|url| is_allowed_session_url("hh", url.as_str()))
}

pub async fn run_hh_raise(
    app: &AppHandle,
    request: HhRaiseRequest,
) -> Result<HhRaiseReport, String> {
    validate_request(&request)?;
    // The window is shared with the response flow: never navigate it mid-response.
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhRaiseReport::of("busy"));
    };
    let label = session_window_label("hh").ok_or("unsupported_platform")?;
    let page = SessionWindowRequest {
        platform: "hh".into(),
        url: resume_url(&request.resume_id),
        layout: None,
        session_key: None,
        // Automatic raise: the window must never take focus from the candidate.
        background: true,
    };
    read_session_page(app, &page).await?;
    let window = app.get_webview(label).ok_or("session_window_missing")?;
    if !on_hh(&window) {
        return Ok(HhRaiseReport::of("foreign_page"));
    }
    let code = wait_for_answer(&window, &page_script()).await;
    Ok(report_for(&code))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str) -> HhRaiseRequest {
        HhRaiseRequest {
            resume_id: id.into(),
        }
    }

    #[test]
    fn accepts_only_bounded_hex_or_digit_ids() {
        assert!(validate_request(&request("0a1b2c3d4e5f")).is_ok());
        assert!(validate_request(&request("1234567")).is_ok());
        assert!(validate_request(&request(&"a".repeat(RESUME_ID_MAX))).is_ok());
        for bad in ["", "xyz", "ab/cd", "ab cd", "a\"b", "../1", "ab?x=1", "résumé"] {
            assert!(validate_request(&request(bad)).is_err(), "{bad}");
        }
        assert!(validate_request(&request(&"a".repeat(RESUME_ID_MAX + 1))).is_err());
    }

    #[test]
    fn opens_the_resume_page_on_hh_only() {
        assert_eq!(resume_url("abc123"), "https://hh.ru/resume/abc123");
        assert!(is_allowed_session_url("hh", &resume_url("abc123")));
        assert!(!is_allowed_session_url("hh", "https://hh.ru.evil.example/resume/abc123"));
    }

    #[test]
    fn maps_page_answers_to_server_outcomes() {
        for known in ["ok", "captcha", "logged_out", "foreign_page", "too_early"] {
            assert_eq!(report_for(known), HhRaiseReport::of(known));
        }
        for other in ["error", "timeout", "script_error", "waiting", "anything"] {
            assert_eq!(report_for(other), HhRaiseReport::of("error"), "{other}");
        }
    }

    #[test]
    fn page_script_embeds_the_marker_and_keeps_no_placeholder() {
        let script = page_script();
        assert!(!script.contains(SIGNED_IN_PLACEHOLDER));
        assert!(script.contains("mainmenu_applicantProfile"));
        assert!(script.contains("Поднять в поиске"));
    }

    #[test]
    fn raises_one_resume_at_a_time_and_never_beside_a_response() {
        let first = RunningGuard::take().expect("free");
        assert!(RunningGuard::take().is_none());
        drop(first);
        assert!(RunningGuard::take().is_some());
    }
}
