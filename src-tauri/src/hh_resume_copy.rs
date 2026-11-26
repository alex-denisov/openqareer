//! B787: a hidden copy of the candidate's hh.ru resume for one vacancy.
//!
//! Three separate steps, each asked for by the cabinet after the candidate pressed
//! «Создать резюме под вакансию»: copy the source, hide the copy from everyone
//! (confirmed only by what a reloaded hh.ru page shows), and delete the copy when it
//! could not be hidden. The source and every other resume the candidate already had
//! are listed as known; hiding and deleting refuse them.

use crate::connector_session::{
    append_connector_diagnostic, eval_json, is_transient_eval_error, session_window_label,
    write_markup_sketch, HH_COPY_MARKUP_FILE,
};
use crate::hh_apply::{on_hh, wait_for, RunningGuard};
use crate::hh_resume_copy_scripts::{
    delete_script, duplicate_script, hide_script, landed_script, menu_script, visibility_script,
};
use crate::hh_resume_edit::{
    editor_url, open_editor, pause_ms, reset_editor, save, wait_before_next_edit,
};
use crate::hh_resume_edit_scripts::edit_path;
use crate::hh_resume_experience::open_clean;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const KNOWN_MAX: usize = 100;
const SCOPE: &str = "hh-copy";
/// Masked sketch of the page a copy step stopped on (B787).
const PAGE_SKETCH_SCRIPT: &str = include_str!("hh_page_sketch.js");

/// One code-only line per copy step; ids and page text never reach the log.
fn note(app: &AppHandle, event: &str, code: &str) {
    let _ = append_connector_diagnostic(app, SCOPE, event, Some(code));
}

/// A failed step leaves the masked page next to the log, overwritten each time.
async fn dump_page(app: &AppHandle) {
    let Some(window) = session_window_label("hh").and_then(|label| app.get_webview(label)) else {
        return;
    };
    if let Ok(raw) = eval_json(&window, PAGE_SKETCH_SCRIPT).await {
        let sketch: String = serde_json::from_str(&raw).unwrap_or(raw);
        if write_markup_sketch(app, HH_COPY_MARKUP_FILE, &sketch).is_err() {
            note(app, "dump", "invalid");
        }
    }
}

/// Logs the outcome of a step; a failure also leaves the page sketch.
async fn traced<T>(app: &AppHandle, event: &str, result: Result<T, String>) -> Result<T, String> {
    match &result {
        Ok(_) => note(app, event, "ok"),
        Err(code) => {
            note(app, event, code);
            dump_page(app).await;
        }
    }
    result
}
const LIST_URL: &str = "https://hh.ru/applicant/resumes";
const VISIBILITY_BLOCK: &str = "visibility";
const STEP_POLL: Duration = Duration::from_millis(500);
const STEP_WAIT: Duration = Duration::from_secs(12);
const LAND_WAIT: Duration = Duration::from_secs(25);
const DELETE_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HhCopyRequest {
    pub source_id: String,
    /// Every resume the candidate had before the copy.
    pub known_ids: Vec<String>,
}

/// Hide or delete the copy; `known_ids` are the resumes that must never be touched.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HhCopyActionRequest {
    pub copy_id: String,
    pub known_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HhCopyReport {
    /// `copied`, `hidden`, `deleted` or `failed`.
    pub outcome: String,
    pub copy_id: Option<String>,
    pub failure_code: Option<String>,
}

impl HhCopyReport {
    fn done(outcome: &str, copy_id: &str) -> Self {
        Self {
            outcome: outcome.into(),
            copy_id: Some(copy_id.into()),
            failure_code: None,
        }
    }
    fn failed(code: &str) -> Self {
        Self {
            outcome: "failed".into(),
            copy_id: None,
            failure_code: Some(code.into()),
        }
    }
}

fn resume_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.chars().all(|c| c.is_ascii_alphanumeric())
}

fn known(ids: &[String]) -> bool {
    !ids.is_empty() && ids.len() <= KNOWN_MAX && ids.iter().all(|id| resume_id(id))
}

pub fn validate_copy(request: &HhCopyRequest) -> Result<(), String> {
    if !resume_id(&request.source_id) || !known(&request.known_ids) {
        return Err("resume_id_invalid".into());
    }
    if request.known_ids.contains(&request.source_id) {
        Ok(())
    } else {
        Err("source_not_listed".into())
    }
}

/// The copy is never one of the resumes the candidate had before it.
pub fn validate_action(request: &HhCopyActionRequest) -> Result<(), String> {
    if !resume_id(&request.copy_id) || !known(&request.known_ids) {
        return Err("resume_id_invalid".into());
    }
    if request.known_ids.contains(&request.copy_id) {
        Err("not_a_copy".into())
    } else {
        Ok(())
    }
}

/// A step that must answer `done`; a timeout becomes `on_timeout`.
fn expect(code: String, done: &str, on_timeout: &str) -> Result<(), String> {
    match code.as_str() {
        c if c == done => Ok(()),
        "timeout" => Err(on_timeout.into()),
        _ => Err(code),
    }
}

async fn human_pause() {
    tokio::time::sleep(Duration::from_millis(pause_ms())).await;
}

/// The id hh.ru opened after «Дублировать».
async fn landed(window: &tauri::Webview, known_ids: &[String]) -> Result<String, String> {
    let script = landed_script(known_ids);
    let deadline = tokio::time::Instant::now() + LAND_WAIT;
    loop {
        if !on_hh(window) {
            return Err("target_redirect_rejected".into());
        }
        match eval_json(window, &script).await {
            Ok(raw) => {
                let value: Value =
                    serde_json::from_str(&raw).map_err(|_| "script_error".to_string())?;
                match value["code"].as_str().unwrap_or("script_error") {
                    "landed" => {
                        let id = value["value"].as_str().unwrap_or_default();
                        return if resume_id(id) {
                            Ok(id.into())
                        } else {
                            Err("script_error".into())
                        };
                    }
                    // Between two pages the sign-in mark may not be drawn yet.
                    "waiting" | "not_signed_in" => {}
                    code => return Err(code.into()),
                }
            }
            Err(error) if !is_transient_eval_error(&error) => return Err("script_error".into()),
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("copy_unconfirmed".into());
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

async fn copy(app: &AppHandle, request: &HhCopyRequest) -> Result<String, String> {
    note(app, "navigate", "list");
    let window = open_clean(app, LIST_URL)
        .await?
        .ok_or("target_redirect_rejected")?;
    let menu = wait_for(&window, &menu_script(&request.source_id), STEP_WAIT).await;
    note(app, "menu", &menu);
    expect(menu, "menu_open", "source_missing")?;
    human_pause().await;
    // From this press on the copy may exist: its code is never a plain refusal.
    let pressed = wait_for(&window, &duplicate_script(), STEP_WAIT).await;
    note(app, "duplicate", &pressed);
    match pressed.as_str() {
        "duplicate_clicked" => landed(&window, &request.known_ids).await,
        "script_error" => Err("copy_unconfirmed".into()),
        "timeout" => Err("menu_missing".into()),
        _ => Err(pressed),
    }
}

pub async fn run_hh_resume_copy(
    app: &AppHandle,
    request: HhCopyRequest,
) -> Result<HhCopyReport, String> {
    validate_copy(&request)?;
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhCopyReport::failed("hh_busy"));
    };
    tokio::time::sleep(wait_before_next_edit()).await;
    Ok(match traced(app, "copy", copy(app, &request).await).await {
        Ok(id) => HhCopyReport::done("copied", &id),
        Err(code) => HhCopyReport::failed(&code),
    })
}

/// What a reloaded visibility editor of the copy shows.
async fn shown_visibility(
    app: &AppHandle,
    copy_id: &str,
) -> Result<(tauri::Webview, String), String> {
    let path = edit_path(copy_id, VISIBILITY_BLOCK);
    let window = open_clean(app, &editor_url(copy_id, VISIBILITY_BLOCK))
        .await?
        .ok_or("target_redirect_rejected")?;
    let code = wait_for(&window, &visibility_script(&path), STEP_WAIT).await;
    Ok((window, code))
}

async fn hide(app: &AppHandle, copy_id: &str) -> Result<(), String> {
    let path = edit_path(copy_id, VISIBILITY_BLOCK);
    let (window, code) = shown_visibility(app, copy_id).await?;
    note(app, "visibility", &code);
    match code.as_str() {
        "hidden" => return Ok(()),
        "visible" => {}
        "timeout" => return Err("editor_missing".into()),
        _ => return Err(code),
    }
    reset_editor(&window).await;
    let chosen = wait_for(&window, &hide_script(&path), STEP_WAIT).await;
    expect(chosen, "chosen", "visibility_not_chosen")?;
    human_pause().await;
    save(&window, &path).await?;
    let (_, code) = shown_visibility(app, copy_id).await?;
    note(app, "visibility_after", &code);
    expect(code, "hidden", "visibility_unconfirmed")
}

pub async fn run_hh_resume_hide(
    app: &AppHandle,
    request: HhCopyActionRequest,
) -> Result<HhCopyReport, String> {
    validate_action(&request)?;
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhCopyReport::failed("hh_busy"));
    };
    // No pause between edits here: every second the copy is visible counts.
    Ok(
        match traced(app, "hide", hide(app, &request.copy_id).await).await {
            Ok(()) => HhCopyReport::done("hidden", &request.copy_id),
            Err(code) => HhCopyReport::failed(&code),
        },
    )
}

async fn delete(app: &AppHandle, copy_id: &str) -> Result<(), String> {
    let window = open_editor(app, &format!("https://hh.ru/resume/{copy_id}")).await?;
    if !on_hh(&window) {
        return Err("target_redirect_rejected".into());
    }
    let code = wait_for(&window, &delete_script(copy_id), DELETE_WAIT).await;
    expect(code, "deleted", "delete_unconfirmed")
}

/// The caller reads the list again: only a resume absent from it counts as deleted.
pub async fn run_hh_resume_delete_copy(
    app: &AppHandle,
    request: HhCopyActionRequest,
) -> Result<HhCopyReport, String> {
    validate_action(&request)?;
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhCopyReport::failed("hh_busy"));
    };
    Ok(
        match traced(app, "delete", delete(app, &request.copy_id).await).await {
            Ok(()) => HhCopyReport::done("deleted", &request.copy_id),
            Err(code) => HhCopyReport::failed(&code),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connector_session::is_allowed_session_url;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn copies_only_a_listed_resume() {
        let request = |source: &str, known: &[&str]| HhCopyRequest {
            source_id: source.into(),
            known_ids: ids(known),
        };
        assert!(validate_copy(&request("abc", &["abc", "def"])).is_ok());
        for bad in [
            request("abc", &[]),
            request("abc", &["def"]),
            request("a/b", &["a/b"]),
            request("abc", &["abc", "x y"]),
        ] {
            assert!(validate_copy(&bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn never_hides_or_deletes_a_resume_the_candidate_already_had() {
        let request = |copy: &str, known: &[&str]| HhCopyActionRequest {
            copy_id: copy.into(),
            known_ids: ids(known),
        };
        assert!(validate_action(&request("new", &["abc"])).is_ok());
        assert_eq!(
            validate_action(&request("abc", &["abc"])),
            Err("not_a_copy".into())
        );
        assert!(validate_action(&request("new", &[])).is_err());
        assert!(validate_action(&request("../new", &["abc"])).is_err());
    }

    #[test]
    fn opens_only_hh_pages() {
        assert!(is_allowed_session_url("hh", LIST_URL));
        assert!(is_allowed_session_url(
            "hh",
            &editor_url("abc", VISIBILITY_BLOCK)
        ));
    }
}
