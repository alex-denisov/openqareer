//! B704: a response to an hh.ru vacancy, sent in the candidate's own hh.ru
//! session window after the candidate confirmed it on the response screen.
//!
//! The steps run as fixed scripts compiled into the app. The web view only
//! passes the vacancy number, the resume id and the letter; each is validated
//! here and embedded as a JSON string literal, so page script can never be
//! supplied from outside. Any unexpected page is a fail-closed stop.

use crate::connector_session::{
    append_connector_diagnostic, eval_json, is_allowed_session_url, is_transient_eval_error,
    read_fresh_session_page, session_window_label, SessionWindowRequest,
};
use crate::hh_apply_scripts::{
    diagnostic_script, letter_script, open_script, popup_script, result_script, resume_script,
    submit_script, window_script,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const LETTER_MAX_CHARS: usize = 10_000;
const STEP_POLL: Duration = Duration::from_millis(500);
/// How long the vacancy page may take to show the sign-in and the button.
const OPEN_WAIT: Duration = Duration::from_secs(10);
const RESUME_TITLE_MAX_CHARS: usize = 300;
const POPUP_WAIT: Duration = Duration::from_secs(10);
/// The resume drop-down and the letter field open after a short animation.
const FORM_STEP_WAIT: Duration = Duration::from_secs(6);
/// Mockup a01d: wait up to a minute for hh.ru to confirm or ask for a questionnaire.
const RESULT_WAIT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HhApplyRequest {
    pub vacancy_id: String,
    pub resume_id: String,
    pub letter: String,
    /// The resume's title, only when no other resume of the candidate has it.
    #[serde(default)]
    pub unique_resume_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HhApplyReport {
    /// `sent`, `questionnaire` or `failed`.
    pub outcome: String,
    pub failure_code: Option<String>,
}

impl HhApplyReport {
    fn sent() -> Self {
        Self {
            outcome: "sent".into(),
            failure_code: None,
        }
    }
    fn questionnaire() -> Self {
        Self {
            outcome: "questionnaire".into(),
            failure_code: None,
        }
    }
    fn failed(code: &str) -> Self {
        Self {
            outcome: "failed".into(),
            failure_code: Some(code.to_string()),
        }
    }
}

#[derive(Deserialize)]
struct StepResult {
    code: String,
}

fn validate_vacancy(vacancy: &str) -> Result<(), String> {
    if vacancy.is_empty()
        || vacancy.len() > 15
        || vacancy.starts_with('0')
        || !vacancy.chars().all(|c| c.is_ascii_digit())
    {
        return Err("vacancy_id_invalid".into());
    }
    Ok(())
}

pub fn validate_request(request: &HhApplyRequest) -> Result<(), String> {
    validate_vacancy(&request.vacancy_id)?;
    let resume = &request.resume_id;
    if resume.is_empty() || resume.len() > 64 || !resume.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("resume_id_invalid".into());
    }
    if request.unique_resume_title.as_deref().is_some_and(|title| {
        title.trim().is_empty()
            || title.chars().count() > RESUME_TITLE_MAX_CHARS
            || title.chars().any(char::is_control)
    }) {
        return Err("resume_title_invalid".into());
    }
    let letter = request.letter.trim();
    if letter.is_empty() || letter.chars().count() > LETTER_MAX_CHARS {
        return Err("letter_invalid".into());
    }
    Ok(())
}

pub fn vacancy_url(vacancy_id: &str) -> String {
    format!("https://hh.ru/vacancy/{vacancy_id}")
}

async fn step(window: &tauri::Webview, script: &str) -> Result<String, String> {
    let raw = eval_json(window, script).await?;
    serde_json::from_str::<StepResult>(&raw)
        .map(|result| result.code)
        .map_err(|_| "step_shape".to_string())
}

/// A page still drawing may look signed out; the answer counts after this time.
const SIGNED_OUT_SETTLE: Duration = Duration::from_secs(4);

/// Whether `code` says "signed out" too early to be believed (B708).
pub(crate) fn is_early_signed_out(code: &str, elapsed: Duration) -> bool {
    matches!(code, "not_signed_in" | "logged_out") && elapsed < SIGNED_OUT_SETTLE
}

/// Polls `script` until it answers something other than `waiting`.
pub(crate) async fn wait_for(window: &tauri::Webview, script: &str, limit: Duration) -> String {
    let started = tokio::time::Instant::now();
    let deadline = started + limit;
    loop {
        match step(window, script).await {
            Ok(code)
                if is_early_signed_out(&code, started.elapsed())
                    && tokio::time::Instant::now() < deadline => {}
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

/// Answers that a vacancy page still filling in may give; they count only once
/// the page had `OPEN_WAIT` to settle.
fn is_unsettled(code: &str) -> bool {
    matches!(
        code,
        "waiting" | "page_not_ready" | "not_signed_in" | "no_response_button"
    )
}

/// The answer for a page that stayed unsettled.
fn settled_code(code: &str) -> &str {
    if code == "waiting" {
        "target_redirect_rejected"
    } else {
        code
    }
}

async fn open_response(window: &tauri::Webview, vacancy_id: &str) -> String {
    let script = open_script(vacancy_id);
    let deadline = tokio::time::Instant::now() + OPEN_WAIT;
    let mut last = "waiting".to_string();
    loop {
        match step(window, &script).await {
            Ok(code) if !is_unsettled(&code) => return code,
            Ok(code) => last = code,
            Err(error) if !is_transient_eval_error(&error) => return "script_error".into(),
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return settled_code(&last).to_string();
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

/// Codes only, on this machine only: which step stopped and what the page held.
async fn explain_failure(
    app: &AppHandle,
    window: &tauri::Webview,
    vacancy_id: &str,
    at: &str,
    code: &str,
) {
    let _ = append_connector_diagnostic(app, "hh-apply", at, Some(code));
    let seen = step(window, &diagnostic_script(vacancy_id)).await;
    let detail = seen.unwrap_or_else(|_| "unreadable".to_string());
    let _ = append_connector_diagnostic(app, "hh-apply", "seen", Some(&detail));
}

/// Maps the last page answer to the report the response screen records.
pub fn report_for(code: &str) -> HhApplyReport {
    match code {
        "sent" => HhApplyReport::sent(),
        "questionnaire" => HhApplyReport::questionnaire(),
        "popup" | "timeout" => HhApplyReport::failed("no_confirmation"),
        other => HhApplyReport::failed(other),
    }
}

pub(crate) fn on_hh(window: &tauri::Webview) -> bool {
    window
        .url()
        .is_ok_and(|url| is_allowed_session_url("hh", url.as_str()))
}

/// One hh.ru action at a time (a response or a resume edit): the hh.ru window is a single page.
static APPLY_RUNNING: AtomicBool = AtomicBool::new(false);

/// Shared with the resume raise (`hh_raise`): both drive the same hh.ru window.
pub(crate) struct RunningGuard;

impl RunningGuard {
    pub(crate) fn take() -> Option<Self> {
        APPLY_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| RunningGuard)
    }
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        APPLY_RUNNING.store(false, Ordering::SeqCst);
    }
}

pub async fn run_hh_apply(
    app: &AppHandle,
    request: HhApplyRequest,
) -> Result<HhApplyReport, String> {
    validate_request(&request)?;
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhApplyReport::failed("apply_running"));
    };
    let label = session_window_label("hh").ok_or("unsupported_platform")?;
    let page = SessionWindowRequest {
        platform: "hh".into(),
        url: vacancy_url(&request.vacancy_id),
        layout: None,
        session_key: None,
        background: false,
    };
    read_fresh_session_page(app, &page).await?;
    let window = app.get_webview(label).ok_or("session_window_missing")?;
    if !on_hh(&window) {
        return Ok(HhApplyReport::failed("target_redirect_rejected"));
    }
    let outcome = respond(&window, &request).await;
    let (at, code) = match &outcome {
        Ok(code) => ("result", code.as_str()),
        Err((at, code)) => (*at, code.as_str()),
    };
    let report = report_for(code);
    if report.outcome == "failed" {
        explain_failure(app, &window, &request.vacancy_id, at, code).await;
    }
    Ok(report)
}

/// The steps on the open vacancy page; `Err` names the step that stopped and why.
async fn respond(
    window: &tauri::Webview,
    request: &HhApplyRequest,
) -> Result<String, (&'static str, String)> {
    let title = request.unique_resume_title.as_deref();
    let opened = open_response(window, &request.vacancy_id).await;
    if opened != "opened" {
        return Err(("open", opened));
    }
    let steps = [
        (
            "popup",
            popup_script(),
            POPUP_WAIT,
            "popup",
            "popup_missing",
        ),
        (
            "resume",
            resume_script(&request.resume_id, title),
            FORM_STEP_WAIT,
            "resume_ok",
            "resume_not_found",
        ),
        (
            "letter",
            letter_script(&request.letter),
            FORM_STEP_WAIT,
            "letter_set",
            "letter_field_missing",
        ),
        (
            "submit",
            submit_script(&request.resume_id, &request.letter),
            FORM_STEP_WAIT,
            "submitted",
            "submit_unavailable",
        ),
    ];
    for (at, script, limit, done, on_timeout) in steps {
        let code = wait_for(window, &script, limit).await;
        if code == "timeout" {
            return Err((at, on_timeout.to_string()));
        }
        if code != done {
            return Err((at, code));
        }
    }
    // After the click the pop-up may stay open while hh.ru answers.
    Ok(wait_for(window, &result_script(), RESULT_WAIT).await)
}

/// B708: `sent` when the open hh.ru window shows the response to this vacancy,
/// `waiting` otherwise. Never navigates, reloads or clicks.
pub async fn read_hh_apply_window(app: &AppHandle, vacancy_id: &str) -> Result<String, String> {
    validate_vacancy(vacancy_id)?;
    let label = session_window_label("hh").ok_or("unsupported_platform")?;
    let window = app.get_webview(label).ok_or("session_window_missing")?;
    match step(&window, &window_script(vacancy_id)).await {
        Ok(code) => Ok(code),
        Err(error) if is_transient_eval_error(&error) || error == "step_shape" => {
            Ok("waiting".into())
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_out_counts_only_after_the_page_had_time_to_draw() {
        for code in ["not_signed_in", "logged_out"] {
            assert!(is_early_signed_out(code, Duration::ZERO));
            assert!(!is_early_signed_out(code, SIGNED_OUT_SETTLE));
        }
        assert!(!is_early_signed_out("captcha", Duration::ZERO));
    }

    fn request(vacancy: &str, resume: &str, letter: &str) -> HhApplyRequest {
        HhApplyRequest {
            vacancy_id: vacancy.into(),
            resume_id: resume.into(),
            letter: letter.into(),
            unique_resume_title: None,
        }
    }

    #[test]
    fn accepts_only_plain_numbers_ids_and_a_bounded_letter() {
        assert!(validate_request(&request("123456", "abc123", "Добрый день")).is_ok());
        for (vacancy, resume, letter) in [
            ("", "abc", "x"),
            ("0123", "abc", "x"),
            ("12a", "abc", "x"),
            ("1234567890123456", "abc", "x"),
            ("1", "", "x"),
            ("1", "a\"b", "x"),
            ("1", "a b", "x"),
            ("1", "abc", "   "),
        ] {
            assert!(
                validate_request(&request(vacancy, resume, letter)).is_err(),
                "{vacancy} {resume}"
            );
        }
        let long = "я".repeat(LETTER_MAX_CHARS + 1);
        assert!(validate_request(&request("1", "abc", &long)).is_err());
    }

    #[test]
    fn accepts_only_a_bounded_plain_resume_title() {
        let with = |title: &str| {
            validate_request(&HhApplyRequest {
                unique_resume_title: Some(title.into()),
                ..request("1", "abc", "Письмо")
            })
        };
        assert!(with("Операционный директор (COO)").is_ok());
        for bad in ["", "  ", "a\nb", "a\u{0}b"] {
            assert!(with(bad).is_err(), "{bad:?}");
        }
        assert!(with(&"я".repeat(RESUME_TITLE_MAX_CHARS)).is_ok());
        assert!(with(&"я".repeat(RESUME_TITLE_MAX_CHARS + 1)).is_err());
    }

    #[test]
    fn a_filling_page_is_asked_again() {
        for code in [
            "waiting",
            "page_not_ready",
            "not_signed_in",
            "no_response_button",
        ] {
            assert!(is_unsettled(code), "{code}");
        }
        for code in ["opened", "already_applied", "captcha", "script_error"] {
            assert!(!is_unsettled(code), "{code}");
        }
        assert_eq!(settled_code("waiting"), "target_redirect_rejected");
        assert_eq!(settled_code("not_signed_in"), "not_signed_in");
    }

    #[test]
    fn opens_from_the_vacancy_page_only() {
        assert_eq!(vacancy_url("77"), "https://hh.ru/vacancy/77");
        assert!(is_allowed_session_url("hh", &vacancy_url("77")));
    }

    #[test]
    fn maps_page_answers_to_reports() {
        assert_eq!(report_for("sent"), HhApplyReport::sent());
        assert_eq!(report_for("questionnaire"), HhApplyReport::questionnaire());
        assert_eq!(
            report_for("timeout"),
            HhApplyReport::failed("no_confirmation")
        );
        assert_eq!(report_for("captcha"), HhApplyReport::failed("captcha"));
        assert_eq!(
            report_for("not_signed_in"),
            HhApplyReport::failed("not_signed_in")
        );
    }

    #[test]
    fn runs_one_response_at_a_time() {
        let first = RunningGuard::take().expect("free");
        assert!(RunningGuard::take().is_none());
        drop(first);
        assert!(RunningGuard::take().is_some());
    }
}
