//! B704: a response to an hh.ru vacancy, sent in the candidate's own hh.ru
//! session window after the candidate confirmed it on the response screen.
//!
//! The steps run as fixed scripts compiled into the app. The web view only
//! passes the vacancy number, the resume id and the letter; each is validated
//! here and embedded as a JSON string literal, so page script can never be
//! supplied from outside. Any unexpected page is a fail-closed stop.

use crate::connector_session::{
    eval_json, is_allowed_session_url, is_transient_eval_error, read_session_page,
    session_window_label, SessionWindowRequest,
};
use crate::hh_apply_scripts::{
    letter_script, open_script, popup_script, result_script, resume_script, submit_script,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const LETTER_MAX_CHARS: usize = 10_000;
const STEP_POLL: Duration = Duration::from_millis(500);
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

pub fn validate_request(request: &HhApplyRequest) -> Result<(), String> {
    let vacancy = &request.vacancy_id;
    if vacancy.is_empty()
        || vacancy.len() > 15
        || vacancy.starts_with('0')
        || !vacancy.chars().all(|c| c.is_ascii_digit())
    {
        return Err("vacancy_id_invalid".into());
    }
    let resume = &request.resume_id;
    if resume.is_empty() || resume.len() > 64 || !resume.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("resume_id_invalid".into());
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

/// Polls `script` until it answers something other than `waiting`.
pub(crate) async fn wait_for(window: &tauri::Webview, script: &str, limit: Duration) -> String {
    let deadline = tokio::time::Instant::now() + limit;
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
    read_session_page(app, &page).await?;
    let window = app.get_webview(label).ok_or("session_window_missing")?;
    if !on_hh(&window) {
        return Ok(HhApplyReport::failed("target_redirect_rejected"));
    }
    let opened = step(&window, &open_script()).await?;
    if opened != "opened" {
        return Ok(report_for(&opened));
    }
    let surface = wait_for(&window, &popup_script(), POPUP_WAIT).await;
    if surface != "popup" {
        return Ok(report_for(if surface == "timeout" {
            "popup_missing"
        } else {
            &surface
        }));
    }
    let form_steps = [
        (
            resume_script(&request.resume_id),
            "resume_ok",
            "resume_not_found",
        ),
        (
            letter_script(&request.letter),
            "letter_set",
            "letter_field_missing",
        ),
        (
            submit_script(&request.letter),
            "submitted",
            "submit_unavailable",
        ),
    ];
    for (script, done, on_timeout) in form_steps {
        let code = wait_for(&window, &script, FORM_STEP_WAIT).await;
        if code != done {
            return Ok(report_for(if code == "timeout" {
                on_timeout
            } else {
                &code
            }));
        }
    }
    // After the click the pop-up may stay open while hh.ru answers.
    let result = wait_for(&window, &result_script(), RESULT_WAIT).await;
    Ok(report_for(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(vacancy: &str, resume: &str, letter: &str) -> HhApplyRequest {
        HhApplyRequest {
            vacancy_id: vacancy.into(),
            resume_id: resume.into(),
            letter: letter.into(),
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
