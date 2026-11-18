//! B704: a response to an hh.ru vacancy, sent in the candidate's own hh.ru
//! session window after the candidate confirmed it on the response screen.
//!
//! The steps run as fixed scripts compiled into the app. The web view only
//! passes the vacancy number, the resume id and the letter; each is validated
//! here and embedded as a JSON string literal, so page script can never be
//! supplied from outside. Any unexpected page is a fail-closed stop.

use crate::connector_session::{
    eval_json, is_allowed_session_url, is_transient_eval_error, read_session_page,
    session_window_label, SessionWindowRequest, HH_SIGNED_IN_SELECTOR,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const HH_RESPONSE_BUTTON_TOP: &str = r#"[data-qa="vacancy-response-link-top"]"#;
pub const HH_RESPONSE_BUTTON_BOTTOM: &str = r#"[data-qa="vacancy-response-link-bottom"]"#;
pub const HH_ALREADY_APPLIED: &str = r#"[data-qa="vacancy-response-already-applied"]"#;
pub const HH_APPLY_POPUP: &str = r#"[data-qa="vacancy-response-popup"]"#;
pub const HH_RESUME_ITEM: &str = r#"[data-qa="vacancy-response-popup__resume-item"]"#;
pub const HH_LETTER_TOGGLE: &str = r#"[data-qa="vacancy-response-popup__letter-toggle"]"#;
pub const HH_LETTER_TEXTAREA: &str = r#"[data-qa="vacancy-response-popup__letter-textarea"]"#;
pub const HH_SUBMIT: &str = r#"[data-qa="vacancy-response-submit-popup"]"#;
pub const HH_QUESTIONNAIRE: &str = r#"[data-qa="vacancy-response-questionnaire"]"#;
pub const HH_SUCCESS: &str = r#"[data-qa="vacancy-response-success"]"#;
pub const HH_CAPTCHA: &str = r#"[data-qa="captcha"], #captcha, .captcha-container"#;

const LETTER_MAX_CHARS: usize = 10_000;
const STEP_POLL: Duration = Duration::from_millis(500);
const POPUP_WAIT: Duration = Duration::from_secs(10);
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

fn literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Shared prelude: a visible-element check and the blocking surfaces.
fn prelude() -> String {
    format!(
        "var q=function(s){{return document.querySelector(s);}};\
var seen=function(s){{var e=q(s);return !!(e&&e.getClientRects().length);}};\
var bodyText=((document.body&&document.body.innerText)||'').slice(0,2000);\
if(seen({captcha})||/(captcha|robot|робот|проверка)/i.test(document.title)||\
/(подтвердите[^.]{{0,80}}(?:робот|человек)|captcha)/i.test(bodyText))return {{code:'captcha'}};",
        captcha = literal(HH_CAPTCHA),
    )
}

pub fn open_script() -> String {
    format!(
        "(function(){{try{{{prelude}\
if(!seen({signed}))return {{code:'not_signed_in'}};\
if(seen({already}))return {{code:'already_applied'}};\
var b=q({top})||q({bottom});if(!b)return {{code:'no_response_button'}};\
b.click();return {{code:'opened'}};}}catch(e){{return {{code:'script_error'}};}}}})()",
        prelude = prelude(),
        signed = literal(HH_SIGNED_IN_SELECTOR),
        already = literal(HH_ALREADY_APPLIED),
        top = literal(HH_RESPONSE_BUTTON_TOP),
        bottom = literal(HH_RESPONSE_BUTTON_BOTTOM),
    )
}

/// hh.ru either opens the response pop-up or, for a vacancy with a
/// questionnaire, takes the candidate to its own response page.
pub fn popup_script() -> String {
    format!(
        "(function(){{try{{{prelude}\
if(location.pathname.indexOf('/applicant/vacancy_response')===0||seen({questionnaire}))return {{code:'questionnaire'}};\
if(seen({success}))return {{code:'sent'}};\
return {{code:seen({popup})?'popup':'waiting'}};}}catch(e){{return {{code:'script_error'}};}}}})()",
        prelude = prelude(),
        questionnaire = literal(HH_QUESTIONNAIRE),
        success = literal(HH_SUCCESS),
        popup = literal(HH_APPLY_POPUP),
    )
}

pub fn fill_script(resume_id: &str, letter: &str) -> String {
    format!(
        "(function(){{try{{{prelude}\
var id={resume};var items=document.querySelectorAll({item});var pick=null;\
for(var i=0;i<items.length;i++){{var it=items[i];var input=it.querySelector('input');\
if(it.getAttribute('data-resume-id')===id||(input&&input.value===id)){{pick=input||it;break;}}}}\
if(!pick)return {{code:'resume_not_found'}};pick.click();\
var area=q({area});if(!area){{var t=q({toggle});if(t)t.click();area=q({area});}}\
if(!area)return {{code:'letter_field_missing'}};\
var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;\
setter.call(area,{letter});area.dispatchEvent(new Event('input',{{bubbles:true}}));\
area.dispatchEvent(new Event('change',{{bubbles:true}}));\
var s=q({submit});if(!s||s.disabled)return {{code:'submit_unavailable'}};\
s.click();return {{code:'submitted'}};}}catch(e){{return {{code:'script_error'}};}}}})()",
        prelude = prelude(),
        resume = literal(resume_id),
        item = literal(HH_RESUME_ITEM),
        area = literal(HH_LETTER_TEXTAREA),
        toggle = literal(HH_LETTER_TOGGLE),
        letter = literal(letter.trim()),
        submit = literal(HH_SUBMIT),
    )
}

async fn step(window: &tauri::Webview, script: &str) -> Result<String, String> {
    let raw = eval_json(window, script).await?;
    serde_json::from_str::<StepResult>(&raw)
        .map(|result| result.code)
        .map_err(|_| "step_shape".to_string())
}

/// Polls `script` until it answers something other than `waiting`.
async fn wait_for(window: &tauri::Webview, script: &str, limit: Duration) -> String {
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

fn on_hh(window: &tauri::Webview) -> bool {
    window
        .url()
        .is_ok_and(|url| is_allowed_session_url("hh", url.as_str()))
}

/// One response at a time: the hh.ru window is a single page shared by every step.
static APPLY_RUNNING: AtomicBool = AtomicBool::new(false);

struct RunningGuard;

impl RunningGuard {
    fn take() -> Option<Self> {
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
    let filled = step(&window, &fill_script(&request.resume_id, &request.letter)).await?;
    if filled != "submitted" {
        return Ok(report_for(&filled));
    }
    // After the click the pop-up may stay open while hh.ru answers.
    let mut result = wait_for(&window, &popup_script(), RESULT_WAIT).await;
    if result == "popup" {
        result = wait_for(&window, &result_script(), RESULT_WAIT).await;
    }
    Ok(report_for(&result))
}

/// The same answer as `popup_script`, but an open pop-up still means "waiting".
fn result_script() -> String {
    popup_script().replace("'popup':'waiting'", "'waiting':'waiting'")
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
    fn embeds_parameters_as_escaped_literals() {
        let script = fill_script("abc123", "Строка\n\"кавычки\" </script> '); alert(1);//");
        assert!(script.contains(r#""Строка\n\"кавычки\" </script> '); alert(1);//""#));
        assert!(script.contains(r#"var id="abc123";"#));
        assert!(!script.contains("alert(1);//\";\n"));
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
    fn result_wait_treats_an_open_popup_as_waiting() {
        assert!(popup_script().contains("'popup':'waiting'"));
        assert!(result_script().contains("'waiting':'waiting'"));
    }

    #[test]
    fn stops_on_a_captcha_by_title_or_page_text() {
        for script in [open_script(), popup_script(), fill_script("abc", "x")] {
            assert!(script.contains("document.title"));
            assert!(script.contains("робот|человек"));
        }
    }

    #[test]
    fn runs_one_response_at_a_time() {
        let first = RunningGuard::take().expect("free");
        assert!(RunningGuard::take().is_none());
        drop(first);
        assert!(RunningGuard::take().is_some());
    }
}
