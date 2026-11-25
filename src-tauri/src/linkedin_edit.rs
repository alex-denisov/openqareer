//! B802: «О себе» of the candidate's own LinkedIn profile, changed in their
//! LinkedIn session after they pressed «Применить», and counted as applied
//! only when a freshly opened form shows the text back.
//!
//! Off in release builds until LinkedIn's edit form is confirmed by a live
//! capture the owner allows (see `linkedin_edit_scripts`).

use crate::connector_session::{
    eval_json, is_session_window_on_screen, is_transient_eval_error, pace_linkedin_navigation,
    session_window_label,
};
use crate::hh_apply::wait_for;
use crate::hh_resume_edit::{field_text, HhResumeEditReport as EditReport};
use crate::linkedin_edit_scripts::{
    edit_link_script, fill_script, read_script, save_script, saved_script,
};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url, Webview};

const PROFILE_URL: &str = "https://www.linkedin.com/in/me/";
const ABOUT_MAX_UTF16: usize = 2_600;
const STEP_POLL: Duration = Duration::from_millis(500);
const PAGE_WAIT: Duration = Duration::from_secs(30);
const SAVE_WAIT: Duration = Duration::from_secs(20);
/// The pause between sections, whoever asks.
const EDIT_MIN_GAP: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedinEditRequest {
    /// Only `about`; every other section keeps «Скопировать» and «Выполнено».
    pub section: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
struct Answer {
    code: String,
    value: Option<String>,
}

#[derive(Default)]
struct Pace {
    running: bool,
    last: Option<Instant>,
}

static PACE: Mutex<Pace> = Mutex::new(Pace {
    running: false,
    last: None,
});

/// One edit at a time; the gap is counted from the end of the previous edit.
struct Running(Duration);

impl Running {
    fn take() -> Option<Self> {
        let mut pace = PACE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if pace.running {
            return None;
        }
        pace.running = true;
        let wait = pace
            .last
            .map(|at| EDIT_MIN_GAP.saturating_sub(at.elapsed()))
            .unwrap_or_default();
        Some(Self(wait))
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let mut pace = PACE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        pace.running = false;
        pace.last = Some(Instant::now());
    }
}

fn validate(request: &LinkedinEditRequest) -> Result<String, String> {
    if request.section != "about" {
        return Err("section_unsupported".into());
    }
    let text = field_text(&request.text);
    if text.is_empty() || text.encode_utf16().count() > ABOUT_MAX_UTF16 {
        return Err("edit_invalid".into());
    }
    Ok(text)
}

/// The form address comes from a page: only the «О себе» form on linkedin.com passes.
fn form_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    let segments: Vec<&str> = url
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let on_form = matches!(
        segments.as_slice(),
        ["in", _, "edit", "forms", "summary", _]
    );
    (url.scheme() == "https" && url.host_str() == Some("www.linkedin.com") && on_form)
        .then_some(url)
}

async fn open(app: &AppHandle, window: &Webview, url: Url) -> Result<(), String> {
    tokio::time::sleep(pace_linkedin_navigation(app)).await;
    window
        .navigate(url)
        .map_err(|_| "page_load_failed".to_string())?;
    // The old document answers until WebKit commits the new one.
    tokio::time::sleep(STEP_POLL * 4).await;
    Ok(())
}

/// Polls a reading script; `Err` carries the page's own answer.
async fn read(window: &Webview, script: &str) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + PAGE_WAIT;
    loop {
        match eval_json(window, script).await {
            Ok(raw) => {
                let answer: Answer =
                    serde_json::from_str(&raw).map_err(|_| "script_error".to_string())?;
                match answer.code.as_str() {
                    "read" => return answer.value.ok_or_else(|| "script_error".into()),
                    "waiting" => {}
                    _ => return Err(answer.code),
                }
            }
            Err(error) if !is_transient_eval_error(&error) => return Err("script_error".into()),
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("layout_unknown".into());
        }
        tokio::time::sleep(STEP_POLL).await;
    }
}

async fn expect(window: &Webview, script: &str, done: &str, late: &str) -> Result<(), String> {
    let limit = if done == "saved" {
        SAVE_WAIT
    } else {
        PAGE_WAIT
    };
    match wait_for(window, script, limit).await.as_str() {
        code if code == done => Ok(()),
        "timeout" => Err(late.into()),
        code => Err(code.into()),
    }
}

async fn apply(app: &AppHandle, window: &Webview, text: &str) -> Result<(), String> {
    let profile = Url::parse(PROFILE_URL).map_err(|_| "page_load_failed".to_string())?;
    open(app, window, profile).await?;
    let link = read(window, &edit_link_script()).await?;
    let form = form_url(&link).ok_or("layout_unknown")?;
    open(app, window, form.clone()).await?;
    expect(window, &fill_script(text), "field_set", "layout_unknown").await?;
    expect(
        window,
        &save_script(text),
        "save_clicked",
        "save_unavailable",
    )
    .await?;
    expect(window, &saved_script(), "saved", "no_confirmation").await?;
    open(app, window, form)
        .await
        .map_err(|_| "saved_unconfirmed".to_string())?;
    let shown = read(window, &read_script())
        .await
        .map_err(|_| "saved_unconfirmed".to_string())?;
    if field_text(&shown) == text {
        Ok(())
    } else {
        Err("not_kept".into())
    }
}

pub async fn run_linkedin_edit(
    app: &AppHandle,
    request: LinkedinEditRequest,
) -> Result<EditReport, String> {
    let text = validate(&request)?;
    if !cfg!(debug_assertions) {
        return Ok(EditReport::failed("form_not_confirmed"));
    }
    let Some(running) = Running::take() else {
        return Ok(EditReport::failed("linkedin_busy"));
    };
    let window = session_window_label("linkedin").and_then(|label| app.get_webview(label));
    let Some(window) = window else {
        return Ok(EditReport::failed("not_signed_in"));
    };
    tokio::time::sleep(running.0).await;
    // The candidate is using the LinkedIn window: do not take the page from them.
    if is_session_window_on_screen(app, "linkedin") {
        return Ok(EditReport::failed("linkedin_busy"));
    }
    Ok(match apply(app, &window, &text).await {
        Ok(()) => EditReport::applied(),
        Err(code) => EditReport::failed(&code),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_about_within_linkedins_limit() {
        let request = |section: &str, text: &str| LinkedinEditRequest {
            section: section.into(),
            text: text.into(),
        };
        assert_eq!(
            validate(&request("about", " a\r\nb ")).as_deref(),
            Ok("a\nb")
        );
        for bad in ["headline", "experience", "skills", "languages"] {
            assert!(validate(&request(bad, "текст")).is_err());
        }
        assert!(validate(&request("about", " ")).is_err());
        assert!(validate(&request("about", &"я".repeat(ABOUT_MAX_UTF16 + 1))).is_err());
    }

    #[test]
    fn opens_only_the_about_form_of_linkedin() {
        assert!(form_url("https://www.linkedin.com/in/ivan/edit/forms/summary/new/").is_some());
        for bad in [
            "https://www.linkedin.com/in/ivan/edit/intro/",
            "https://www.linkedin.com/in/ivan/edit/forms/position/1/",
            "https://www.linkedin.com.evil.example/in/ivan/edit/forms/summary/new/",
            "http://www.linkedin.com/in/ivan/edit/forms/summary/new/",
        ] {
            assert!(form_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn runs_one_edit_at_a_time_and_pauses_before_the_next() {
        let first = Running::take().expect("free");
        assert!(Running::take().is_none());
        drop(first);
        let next = Running::take().expect("free again");
        assert!(next.0 > Duration::ZERO && next.0 <= EDIT_MIN_GAP);
    }
}
