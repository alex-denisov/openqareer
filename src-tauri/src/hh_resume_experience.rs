//! B678 slice 4: a reworded place of work applied to one hh.ru resume, after
//! the candidate pressed «Применить» and confirmed it.
//!
//! hh.ru keeps places of work in the profile and ticks them per resume. The
//! original place is copied into a new one with the new text, ticked for this
//! resume only; this resume's tick of the original is removed and its text is
//! never changed. Any step that does not find what it expects stops the run
//! before a save, and only what hh.ru shows on a fresh page counts as applied.

use crate::connector_session::{eval_json, is_transient_eval_error};
use crate::hh_apply::{on_hh, RunningGuard};
use crate::hh_resume_edit::{
    field_text, open_editor, plain_line, wait_before_next_edit, HhResumeEditReport,
};
use crate::hh_resume_experience_scripts::{
    add_script, cancel_script, fill_script, item_save_script, locate_script, page_save_script,
    read_back_script, read_original_script, reset_script, untick_script, PlaceFields, PlaceKey,
};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;

const NAME_MAX_CHARS: usize = 200;
const WAS_MAX_CHARS: usize = 10_000;
const TEXT_MAX_CHARS: usize = 4_000;
const STEP_POLL: Duration = Duration::from_millis(500);
const STEP_WAIT: Duration = Duration::from_secs(10);
const FILL_WAIT: Duration = Duration::from_secs(30);
const SAVE_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HhExperienceEditRequest {
    pub resume_id: String,
    /// The place as the resume shows it: employer, position and its current text.
    pub employer: String,
    pub position: String,
    pub was: String,
    /// The reworded text of the place.
    pub text: String,
}

pub fn validate_request(request: &HhExperienceEditRequest) -> Result<(), String> {
    let resume = &request.resume_id;
    if resume.is_empty() || resume.len() > 64 || !resume.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("resume_id_invalid".into());
    }
    let bounded = |value: &str, max: usize| {
        let trimmed = value.trim();
        !trimmed.is_empty() && trimmed.chars().count() <= max
    };
    let valid = plain_line(&request.employer, NAME_MAX_CHARS)
        && plain_line(&request.position, NAME_MAX_CHARS)
        && bounded(&request.was, WAS_MAX_CHARS)
        && bounded(&request.text, TEXT_MAX_CHARS)
        && field_text(&request.text) != field_text(&request.was);
    if valid {
        Ok(())
    } else {
        Err("edit_invalid".into())
    }
}

pub fn editor_url(resume_id: &str) -> String {
    format!("https://hh.ru/resume/edit/{resume_id}/experience")
}

fn place_of(request: &HhExperienceEditRequest) -> PlaceKey {
    PlaceKey {
        employer: request.employer.trim().to_string(),
        position: request.position.trim().to_string(),
        was: request.was.trim().to_string(),
    }
}

/// Polls a script until it answers something other than `waiting`; `Err` is
/// `timeout` or `script_error`.
async fn poll(window: &tauri::Webview, script: &str, limit: Duration) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        match eval_json(window, script).await {
            Ok(raw) => {
                let value: Value =
                    serde_json::from_str(&raw).map_err(|_| "script_error".to_string())?;
                if value["code"] != "waiting" {
                    return Ok(value);
                }
            }
            Err(error) if !is_transient_eval_error(&error) => return Err("script_error".into()),
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("timeout".into());
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

/// One step that must answer `done`; a timeout becomes `on_timeout`, any other
/// answer is the failure code itself.
async fn step(
    window: &tauri::Webview,
    script: &str,
    limit: Duration,
    done: &str,
    on_timeout: &str,
) -> Result<Value, String> {
    match poll(window, script, limit).await {
        Ok(value) if value["code"] == done => Ok(value),
        Ok(value) => Err(value["code"].as_str().unwrap_or("script_error").to_string()),
        Err(code) if code == "timeout" => Err(on_timeout.to_string()),
        Err(code) => Err(code),
    }
}

/// The original must be ticked for this resume and untickable, or nothing is done.
pub fn located_failure(found: &Value) -> Option<&'static str> {
    if found["locked"] == true {
        Some("original_locked")
    } else if found["checked"] != true {
        Some("place_not_in_resume")
    } else {
        None
    }
}

/// Only the new place ticked and the original unticked, as hh.ru shows it, is applied.
pub fn read_back_report(read: Result<Value, String>) -> HhResumeEditReport {
    match read {
        Ok(value) if value["added"] == true && value["originalTicked"] == false => {
            HhResumeEditReport::applied()
        }
        Ok(value) if value["code"] == "read" => HhResumeEditReport::failed("not_kept"),
        _ => HhResumeEditReport::failed("saved_unconfirmed"),
    }
}

async fn open_clean(app: &AppHandle, url: &str) -> Result<Option<tauri::Webview>, String> {
    let window = open_editor(app, url).await?;
    if !on_hh(&window) {
        return Ok(None);
    }
    let _ = eval_json(&window, &reset_script()).await;
    Ok(Some(window))
}

/// Up to and including the save of the new place: nothing reaches hh.ru before
/// the new place is filled and ticked for this resume only.
async fn add_place(
    window: &tauri::Webview,
    request: &HhExperienceEditRequest,
    place: &PlaceKey,
) -> Result<(), String> {
    let found = step(
        window,
        &locate_script(place),
        STEP_WAIT,
        "located",
        "editor_missing",
    )
    .await?;
    if let Some(code) = located_failure(&found) {
        return Err(code.into());
    }
    let read = step(
        window,
        &read_original_script(place),
        STEP_WAIT,
        "read",
        "form_missing",
    )
    .await?;
    let fields: PlaceFields =
        serde_json::from_value(read["fields"].clone()).map_err(|_| "form_missing".to_string())?;
    step(
        window,
        &cancel_script(),
        STEP_WAIT,
        "closed",
        "cancel_failed",
    )
    .await?;
    step(
        window,
        &add_script(),
        STEP_WAIT,
        "form_open",
        "add_unavailable",
    )
    .await?;
    let text = field_text(&request.text);
    let fill = fill_script(&fields, &text, &request.resume_id);
    step(window, &fill, FILL_WAIT, "filled", "fill_incomplete").await?;
    step(
        window,
        &item_save_script(),
        SAVE_WAIT,
        "item_saved",
        "no_confirmation",
    )
    .await?;
    Ok(())
}

pub async fn run_hh_experience_edit(
    app: &AppHandle,
    request: HhExperienceEditRequest,
) -> Result<HhResumeEditReport, String> {
    validate_request(&request)?;
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhResumeEditReport::failed("hh_busy"));
    };
    tokio::time::sleep(wait_before_next_edit()).await;
    let url = editor_url(&request.resume_id);
    let place = place_of(&request);
    let Some(window) = open_clean(app, &url).await? else {
        return Ok(HhResumeEditReport::failed("target_redirect_rejected"));
    };
    if let Err(code) = add_place(&window, &request, &place).await {
        return Ok(HhResumeEditReport::failed(&code));
    }
    if let Err(code) = step(
        &window,
        &untick_script(&place),
        STEP_WAIT,
        "unticked",
        "original_still_ticked",
    )
    .await
    {
        return Ok(HhResumeEditReport::failed(&code));
    }
    match poll(&window, &page_save_script(), SAVE_WAIT).await {
        Ok(value) if value["code"] == "saved" || value["code"] == "no_page_save" => {}
        Err(code) if code == "timeout" => {}
        Ok(value) => {
            let code = value["code"].as_str().unwrap_or("script_error");
            return Ok(HhResumeEditReport::failed(code));
        }
        Err(code) => return Ok(HhResumeEditReport::failed(&code)),
    }
    let Some(window) = open_clean(app, &url).await? else {
        return Ok(HhResumeEditReport::failed("saved_unconfirmed"));
    };
    let text = field_text(&request.text);
    Ok(read_back_report(
        poll(&window, &read_back_script(&place, &text), STEP_WAIT).await,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connector_session::is_allowed_session_url;
    use serde_json::json;

    fn request() -> HhExperienceEditRequest {
        HhExperienceEditRequest {
            resume_id: "abc123".into(),
            employer: "ООО «Ромашка»".into(),
            position: "Руководитель отдела продаж".into(),
            was: "Руководил отделом".into(),
            text: "Вырастил выручку на 40 %\nВыстроил воронку".into(),
        }
    }

    #[test]
    fn accepts_one_bounded_place_with_new_text() {
        assert!(validate_request(&request()).is_ok());
        let cases: [fn(&mut HhExperienceEditRequest); 8] = [
            |r| r.resume_id = "a/../b".into(),
            |r| r.employer = String::new(),
            |r| r.employer = "две\nстроки".into(),
            |r| r.position = "я".repeat(NAME_MAX_CHARS + 1),
            |r| r.was = "  ".into(),
            |r| r.text = String::new(),
            |r| r.text = "я".repeat(TEXT_MAX_CHARS + 1),
            |r| r.text = " Руководил отделом\r\n".into(),
        ];
        for change in cases {
            let mut bad = request();
            change(&mut bad);
            assert!(validate_request(&bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn opens_only_the_hh_experience_editor() {
        let url = editor_url("abc123");
        assert_eq!(url, "https://hh.ru/resume/edit/abc123/experience");
        assert!(is_allowed_session_url("hh", &url));
    }

    #[test]
    fn acts_only_on_an_original_ticked_here_and_untickable() {
        assert_eq!(
            located_failure(&json!({"checked": true, "locked": false})),
            None
        );
        assert_eq!(
            located_failure(&json!({"checked": true, "locked": true})),
            Some("original_locked")
        );
        assert_eq!(
            located_failure(&json!({"checked": false, "locked": false})),
            Some("place_not_in_resume")
        );
    }

    #[test]
    fn counts_as_applied_only_the_new_place_ticked_and_the_original_not() {
        let read = |added: bool, original: bool| {
            Ok(json!({"code": "read", "added": added, "originalTicked": original}))
        };
        assert_eq!(
            read_back_report(read(true, false)),
            HhResumeEditReport::applied()
        );
        assert_eq!(
            read_back_report(read(true, true)),
            HhResumeEditReport::failed("not_kept")
        );
        assert_eq!(
            read_back_report(read(false, false)),
            HhResumeEditReport::failed("not_kept")
        );
        assert_eq!(
            read_back_report(Err("captcha".into())),
            HhResumeEditReport::failed("saved_unconfirmed")
        );
        assert_eq!(
            read_back_report(Ok(json!({"code": "captcha"}))),
            HhResumeEditReport::failed("saved_unconfirmed")
        );
    }
}
