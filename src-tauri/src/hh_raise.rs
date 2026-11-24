//! B699: raising the candidate's resume on hh.ru («Поднять в поиске»), in the
//! candidate's own hh.ru session window and only for a task the server handed
//! out. The web view passes the resume id; it is validated here and put into
//! the address, so page script can never be supplied from outside. The page
//! script (`hh_raise_page.js`) reads no views or invitations: it classifies the
//! page and presses one button. Anything unexpected is reported, never retried.

use crate::connector_session::{
    append_connector_diagnostic, eval_json, is_allowed_session_url, is_transient_eval_error,
    read_session_page, session_window_label, SessionWindowRequest, HH_SIGNED_IN_SELECTOR,
};
use crate::hh_apply::{is_early_signed_out, RunningGuard};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const RESUME_ID_MAX: usize = 64;
const STEP_POLL: Duration = Duration::from_millis(500);
/// The resume page draws, the button is pressed and hh.ru answers within this time.
const RESUME_WAIT: Duration = Duration::from_secs(12);
/// The same on the resume list, navigation included.
const LIST_WAIT: Duration = Duration::from_secs(20);
const LIST_URL: &str = "https://hh.ru/applicant/resumes";
const PAGE_SCRIPT: &str = include_str!("hh_raise_page.js");
const SIGNED_IN_PLACEHOLDER: &str = "__SIGNED_IN_SELECTOR__";
const RESUME_ID_PLACEHOLDER: &str = "__RESUME_ID__";
const LIST_MODE_PLACEHOLDER: &str = "__LIST_MODE__";
const MAY_PRESS_PLACEHOLDER: &str = "__MAY_PRESS__";

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
    /// The raise button has been pressed in this run.
    #[serde(default)]
    pressed: bool,
    /// Absent unless the list shows no card of this resume.
    #[serde(default = "card_found")]
    card: bool,
}

fn card_found() -> bool {
    true
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Resume,
    List,
}

struct Answer {
    code: String,
    pressed: bool,
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

/// The page script with the run's values embedded as JSON literals.
fn page_script(resume_id: &str, page: Page, may_press: bool) -> String {
    let literal = |value: &str| serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string());
    PAGE_SCRIPT
        .replace(SIGNED_IN_PLACEHOLDER, &literal(HH_SIGNED_IN_SELECTOR))
        .replace(RESUME_ID_PLACEHOLDER, &literal(resume_id))
        .replace(LIST_MODE_PLACEHOLDER, &(page == Page::List).to_string())
        .replace(MAY_PRESS_PLACEHOLDER, &may_press.to_string())
}

/// Why the time ran out, for the local diagnostics log.
fn timeout_reason(page: Page, pressed: bool, card: bool) -> &'static str {
    match (page, pressed, card) {
        (_, true, _) => "timeout_unconfirmed",
        (Page::List, false, false) => "list_no_card",
        _ => "timeout_no_button",
    }
}

fn is_timeout(code: &str) -> bool {
    matches!(
        code,
        "timeout_unconfirmed" | "list_no_card" | "timeout_no_button"
    )
}

/// Maps the last page answer to one of the outcomes the server accepts.
pub fn report_for(code: &str) -> HhRaiseReport {
    match code {
        "ok" | "captcha" | "logged_out" | "foreign_page" | "too_early" => HhRaiseReport::of(code),
        _ => HhRaiseReport::of("error"),
    }
}

async fn step(window: &tauri::Webview, script: &str) -> Result<StepResult, String> {
    let raw = eval_json(window, script).await?;
    serde_json::from_str::<StepResult>(&raw).map_err(|_| "step_shape".to_string())
}

/// Polls the page script until it answers something other than `waiting`.
async fn wait_for_answer(
    window: &tauri::Webview,
    resume_id: &str,
    page: Page,
    may_press: bool,
) -> Answer {
    let script = page_script(resume_id, page, may_press);
    let started = tokio::time::Instant::now();
    let limit = match page {
        Page::Resume => RESUME_WAIT,
        Page::List => LIST_WAIT,
    };
    let mut pressed = !may_press;
    // Until the list shows this resume's card, it has none.
    let mut card = page == Page::Resume;
    let answer = |code: &str, pressed| Answer {
        code: code.to_string(),
        pressed,
    };
    loop {
        match step(window, &script).await {
            Ok(result) if is_early_signed_out(&result.code, started.elapsed()) => {}
            Ok(result) if result.code != "waiting" => {
                return answer(&result.code, pressed || result.pressed)
            }
            Ok(result) => {
                pressed |= result.pressed;
                card = result.card;
            }
            Err(error) if !is_transient_eval_error(&error) => {
                return answer("script_error", pressed)
            }
            Err(_) => {}
        }
        if started.elapsed() >= limit {
            return answer(timeout_reason(page, pressed, card), pressed);
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

/// The resume page first; when it settles nothing in time, the resume list once.
async fn raise(window: &tauri::Webview, resume_id: &str) -> String {
    let first = wait_for_answer(window, resume_id, Page::Resume, true).await;
    if !is_timeout(&first.code) {
        return first.code;
    }
    let Ok(list) = LIST_URL.parse() else {
        return first.code;
    };
    if window.navigate(list).is_err() {
        return first.code;
    }
    tokio::time::sleep(STEP_POLL).await;
    wait_for_answer(window, resume_id, Page::List, !first.pressed)
        .await
        .code
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
    let code = raise(&window, &request.resume_id).await;
    if !matches!(code.as_str(), "ok" | "too_early") {
        let _ = append_connector_diagnostic(app, "hh-raise", "failed", Some(&code));
    }
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
        for bad in [
            "", "xyz", "ab/cd", "ab cd", "a\"b", "../1", "ab?x=1", "résumé",
        ] {
            assert!(validate_request(&request(bad)).is_err(), "{bad}");
        }
        assert!(validate_request(&request(&"a".repeat(RESUME_ID_MAX + 1))).is_err());
    }

    #[test]
    fn opens_the_resume_page_on_hh_only() {
        assert_eq!(resume_url("abc123"), "https://hh.ru/resume/abc123");
        assert!(is_allowed_session_url("hh", &resume_url("abc123")));
        assert!(!is_allowed_session_url(
            "hh",
            "https://hh.ru.evil.example/resume/abc123"
        ));
    }

    #[test]
    fn maps_page_answers_to_server_outcomes() {
        for known in ["ok", "captcha", "logged_out", "foreign_page", "too_early"] {
            assert_eq!(report_for(known), HhRaiseReport::of(known));
        }
        for other in [
            "error",
            "timeout_no_button",
            "timeout_unconfirmed",
            "list_no_card",
            "script_error",
            "waiting",
        ] {
            assert_eq!(report_for(other), HhRaiseReport::of("error"), "{other}");
        }
    }

    #[test]
    fn page_script_embeds_the_run_and_keeps_no_placeholder() {
        let script = page_script("abc123", Page::List, false);
        let code = script.split_once("(function").expect("script body").1;
        for placeholder in [
            SIGNED_IN_PLACEHOLDER,
            RESUME_ID_PLACEHOLDER,
            LIST_MODE_PLACEHOLDER,
            MAY_PRESS_PLACEHOLDER,
        ] {
            assert!(!code.contains(placeholder), "{placeholder}");
        }
        assert!(code.contains("mainmenu_applicantProfile"));
        assert!(code.contains("var resumeId = \"abc123\";"));
        assert!(code.contains("var listMode = true;"));
        assert!(code.contains("var mayPress = false;"));
    }

    #[test]
    fn names_why_the_time_ran_out() {
        assert_eq!(
            timeout_reason(Page::Resume, false, true),
            "timeout_no_button"
        );
        assert_eq!(timeout_reason(Page::List, false, true), "timeout_no_button");
        assert_eq!(timeout_reason(Page::List, false, false), "list_no_card");
        for page in [Page::Resume, Page::List] {
            assert_eq!(timeout_reason(page, true, false), "timeout_unconfirmed");
        }
        assert!(is_timeout("list_no_card") && !is_timeout("captcha"));
    }

    #[test]
    fn reads_a_step_answer_without_the_optional_fields() {
        let step: StepResult = serde_json::from_str(r#"{"code":"ok"}"#).expect("shape");
        assert!(!step.pressed && step.card);
        let step: StepResult =
            serde_json::from_str(r#"{"code":"waiting","pressed":true,"card":false}"#)
                .expect("shape");
        assert!(step.pressed && !step.card);
    }

    #[test]
    fn raises_one_resume_at_a_time_and_never_beside_a_response() {
        let first = RunningGuard::take().expect("free");
        assert!(RunningGuard::take().is_none());
        drop(first);
        assert!(RunningGuard::take().is_some());
    }
}
