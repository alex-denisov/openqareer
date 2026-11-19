//! B678 slice 3: one section of the candidate's hh.ru resume (title, key
//! skills or «О себе») changed in the candidate's own hh.ru window, after the
//! candidate pressed «Применить» and confirmed it.
//!
//! As with the response (B704), the web view passes only the resume id, the
//! section and its new text; each is validated here and embedded as a JSON
//! string literal into fixed scripts. After the save the section is opened
//! again and read back: only what hh.ru shows counts as applied.

use crate::connector_session::{
    eval_json, is_transient_eval_error, read_session_page, session_window_label,
    SessionWindowRequest,
};
use crate::hh_apply::{on_hh, wait_for, RunningGuard};
use crate::hh_resume_edit_scripts::{
    block_of, edit_path, field_script, read_field_script, read_skills_script, save_script,
    saved_script, skill_script, HH_EDIT_ABOUT, HH_EDIT_TITLE,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const TITLE_MAX_CHARS: usize = 100;
const ABOUT_MAX_CHARS: usize = 4_000;
const SKILLS_MAX: usize = 30;
const SKILL_MAX_CHARS: usize = 80;
const STEP_POLL: Duration = Duration::from_millis(500);
const FIELD_WAIT: Duration = Duration::from_secs(10);
const SKILL_WAIT: Duration = Duration::from_secs(6);
const SAVE_WAIT: Duration = Duration::from_secs(20);
/// A person adds skills one by one; so does the script, with a pause between.
const SKILL_PAUSE_MS: (u64, u64) = (900, 1_800);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HhResumeEditRequest {
    pub resume_id: String,
    /// `title`, `skills` or `about`.
    pub section: String,
    /// The new title or «О себе»; empty for skills.
    #[serde(default)]
    pub text: String,
    /// Skills to add (never removed); empty for the other sections.
    #[serde(default)]
    pub skills: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HhResumeEditReport {
    /// `applied` or `failed`.
    pub outcome: String,
    pub failure_code: Option<String>,
}

impl HhResumeEditReport {
    fn applied() -> Self {
        Self {
            outcome: "applied".into(),
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

fn plain_line(value: &str, max: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= max && !trimmed.contains(['\n', '\r'])
}

pub fn validate_request(request: &HhResumeEditRequest) -> Result<(), String> {
    let resume = &request.resume_id;
    if resume.is_empty() || resume.len() > 64 || !resume.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("resume_id_invalid".into());
    }
    let valid = match request.section.as_str() {
        "title" => plain_line(&request.text, TITLE_MAX_CHARS) && request.skills.is_empty(),
        "about" => {
            let text = request.text.trim();
            !text.is_empty() && text.chars().count() <= ABOUT_MAX_CHARS && request.skills.is_empty()
        }
        "skills" => {
            !request.skills.is_empty()
                && request.skills.len() <= SKILLS_MAX
                && request.text.is_empty()
                && request
                    .skills
                    .iter()
                    .all(|skill| plain_line(skill, SKILL_MAX_CHARS))
        }
        _ => return Err("section_invalid".into()),
    };
    if valid {
        Ok(())
    } else {
        Err("edit_invalid".into())
    }
}

fn normalized(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// What hh.ru shows after the save matches what the candidate applied.
pub fn read_back_matches(request: &HhResumeEditRequest, read: &ReadBack) -> bool {
    match request.section.as_str() {
        "skills" => {
            let shown: Vec<String> = read.values.iter().map(|value| normalized(value)).collect();
            request
                .skills
                .iter()
                .all(|skill| shown.contains(&normalized(skill)))
        }
        _ => read
            .value
            .as_deref()
            .is_some_and(|value| value.trim().replace("\r\n", "\n") == request.text.trim()),
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct ReadBack {
    code: String,
    value: Option<String>,
    #[serde(default)]
    values: Vec<String>,
}

pub fn editor_url(resume_id: &str, block: &str) -> String {
    format!("https://hh.ru{}", edit_path(resume_id, block))
}

async fn open_editor(app: &AppHandle, url: &str) -> Result<tauri::Webview, String> {
    let label = session_window_label("hh").ok_or("unsupported_platform")?;
    let page = SessionWindowRequest {
        platform: "hh".into(),
        url: url.to_string(),
        layout: None,
        session_key: None,
        background: false,
    };
    read_session_page(app, &page).await?;
    app.get_webview(label)
        .ok_or_else(|| "session_window_missing".to_string())
}

fn pause_ms() -> u64 {
    let (low, high) = SKILL_PAUSE_MS;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::from(elapsed.subsec_nanos()))
        .unwrap_or(0);
    low + nanos % (high - low)
}

/// Fills the section; `Err` carries the failure code.
async fn fill(
    window: &tauri::Webview,
    request: &HhResumeEditRequest,
    path: &str,
) -> Result<(), String> {
    let expect = |code: String, done: &str, on_timeout: &str| match code.as_str() {
        c if c == done => Ok(()),
        "timeout" => Err(on_timeout.to_string()),
        _ => Err(code),
    };
    match request.section.as_str() {
        "title" => expect(
            wait_for(
                window,
                &field_script(path, HH_EDIT_TITLE, request.text.trim()),
                FIELD_WAIT,
            )
            .await,
            "field_set",
            "field_missing",
        ),
        "about" => expect(
            wait_for(
                window,
                &field_script(path, HH_EDIT_ABOUT, request.text.trim()),
                FIELD_WAIT,
            )
            .await,
            "field_set",
            "field_missing",
        ),
        _ => {
            for (index, skill) in request.skills.iter().enumerate() {
                if index > 0 {
                    tokio::time::sleep(Duration::from_millis(pause_ms())).await;
                }
                let code = wait_for(window, &skill_script(path, skill.trim()), SKILL_WAIT).await;
                expect(code, "skill_present", "skill_not_added")?;
            }
            Ok(())
        }
    }
}

async fn read_back(window: &tauri::Webview, script: &str) -> Option<ReadBack> {
    let deadline = tokio::time::Instant::now() + FIELD_WAIT;
    loop {
        match eval_json(window, script).await {
            Ok(raw) => {
                let parsed = serde_json::from_str::<ReadBack>(&raw).ok()?;
                if parsed.code == "read" {
                    return Some(parsed);
                }
                if parsed.code != "waiting" {
                    return None;
                }
            }
            Err(error) if !is_transient_eval_error(&error) => return None,
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

pub async fn run_hh_resume_edit(
    app: &AppHandle,
    request: HhResumeEditRequest,
) -> Result<HhResumeEditReport, String> {
    validate_request(&request)?;
    let block = block_of(&request.section).ok_or("section_invalid")?;
    let Some(_running) = RunningGuard::take() else {
        return Ok(HhResumeEditReport::failed("hh_busy"));
    };
    let path = edit_path(&request.resume_id, block);
    let url = editor_url(&request.resume_id, block);
    let window = open_editor(app, &url).await?;
    if !on_hh(&window) {
        return Ok(HhResumeEditReport::failed("target_redirect_rejected"));
    }
    if let Err(code) = fill(&window, &request, &path).await {
        return Ok(HhResumeEditReport::failed(&code));
    }
    let clicked = wait_for(&window, &save_script(&path), FIELD_WAIT).await;
    if clicked != "save_clicked" {
        return Ok(HhResumeEditReport::failed(if clicked == "timeout" {
            "save_unavailable"
        } else {
            &clicked
        }));
    }
    let saved = wait_for(&window, &saved_script(&path), SAVE_WAIT).await;
    if saved != "saved" {
        return Ok(HhResumeEditReport::failed(if saved == "timeout" {
            "no_confirmation"
        } else {
            &saved
        }));
    }
    let window = open_editor(app, &url).await?;
    let script = match request.section.as_str() {
        "title" => read_field_script(&path, HH_EDIT_TITLE),
        "about" => read_field_script(&path, HH_EDIT_ABOUT),
        _ => read_skills_script(&path),
    };
    let read = read_back(&window, &script).await;
    Ok(match read {
        Some(read) if read_back_matches(&request, &read) => HhResumeEditReport::applied(),
        Some(_) => HhResumeEditReport::failed("not_kept"),
        None => HhResumeEditReport::failed("read_back_failed"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connector_session::is_allowed_session_url;

    fn request(section: &str, text: &str, skills: &[&str]) -> HhResumeEditRequest {
        HhResumeEditRequest {
            resume_id: "abc123".into(),
            section: section.into(),
            text: text.into(),
            skills: skills.iter().map(|skill| skill.to_string()).collect(),
        }
    }

    #[test]
    fn accepts_only_the_three_sections_with_bounded_text() {
        assert!(validate_request(&request("title", "COO", &[])).is_ok());
        assert!(validate_request(&request("about", "Строка\nещё", &[])).is_ok());
        assert!(validate_request(&request("skills", "", &["SQL", "dbt"])).is_ok());
        for bad in [
            request("experience", "x", &[]),
            request("title", "", &[]),
            request("title", "две\nстроки", &[]),
            request("title", &"я".repeat(TITLE_MAX_CHARS + 1), &[]),
            request("about", &"я".repeat(ABOUT_MAX_CHARS + 1), &[]),
            request("skills", "", &[]),
            request("skills", "", &[&"я".repeat(SKILL_MAX_CHARS + 1)]),
            request("skills", "текст", &["SQL"]),
            request("title", "COO", &["SQL"]),
        ] {
            assert!(validate_request(&bad).is_err(), "{bad:?}");
        }
        let many: Vec<&str> = std::iter::repeat_n("SQL", SKILLS_MAX + 1).collect();
        assert!(validate_request(&request("skills", "", &many)).is_err());
        let mut hostile = request("title", "COO", &[]);
        hostile.resume_id = "a/../b".into();
        assert!(validate_request(&hostile).is_err());
    }

    #[test]
    fn edits_only_on_hh_editor_pages() {
        let url = editor_url("abc123", "keySkills");
        assert_eq!(url, "https://hh.ru/resume/edit/abc123/keySkills");
        assert!(is_allowed_session_url("hh", &url));
    }

    #[test]
    fn counts_as_applied_only_what_hh_shows_back() {
        let title = request("title", "COO", &[]);
        let shown = |value: &str| ReadBack {
            code: "read".into(),
            value: Some(value.into()),
            values: vec![],
        };
        assert!(read_back_matches(&title, &shown("COO")));
        assert!(!read_back_matches(&title, &shown("Директор")));
        let skills = request("skills", "", &["Kubernetes", "dbt"]);
        let chips = |values: &[&str]| ReadBack {
            code: "read".into(),
            value: None,
            values: values.iter().map(|value| value.to_string()).collect(),
        };
        assert!(read_back_matches(
            &skills,
            &chips(&["sql", "kubernetes", "dbt"])
        ));
        assert!(!read_back_matches(&skills, &chips(&["sql", "kubernetes"])));
    }

    #[test]
    fn pauses_between_skills_like_a_person() {
        let pause = pause_ms();
        assert!((SKILL_PAUSE_MS.0..SKILL_PAUSE_MS.1).contains(&pause));
    }
}
