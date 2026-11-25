//! B802: a one-off, read-only capture of three LinkedIn edit forms («О себе»,
//! headline, position) in the owner's own hidden session.
//!
//! Runs only when the owner's Mac holds the flag file
//! `diagnostics/linkedin-form-capture`; the flag is removed before the first
//! page opens, so one flag is one run. Nothing is typed or pressed, nothing
//! is sent anywhere: the pages are written to `linkedin-study/forms`.

use crate::connector_session::{
    append_connector_diagnostic, bound_account_key, close_session_window, create_private_directory,
    eval_json, is_session_window_on_screen, is_transient_eval_error, open_session_window,
    pace_linkedin_navigation, session_window_label, SessionWindowRequest,
};
use crate::AppState;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, Url, Webview};

const FLAG: &str = "linkedin-form-capture";
const PROFILE_URL: &str = "https://www.linkedin.com/in/me/";
const CAPTURE_SCRIPT: &str = include_str!("linkedin_form_capture.js");
const STATE_SCRIPT: &str = include_str!("linkedin_form_state.js");
/// An older flag is forgotten, not obeyed.
const FLAG_MAX_AGE: Duration = Duration::from_secs(10 * 60);
/// File name, and the path that follows `/in/<slug>/` on the form's page.
const FORMS: [(&str, &str); 3] = [
    ("summary", "edit/forms/summary/"),
    ("intro", "edit/intro/"),
    ("position", "edit/forms/position/"),
];
/// Other background reads of the app start go first.
const START_DELAY: Duration = Duration::from_secs(60);
const PAGE_SETTLE: Duration = Duration::from_secs(20);
const FORM_PAUSE: Duration = Duration::from_secs(60);
const EVAL_TRIES: usize = 5;
const MAX_HTML_BYTES: usize = 16 * 1_024 * 1_024;

static RUNNING: AtomicBool = AtomicBool::new(false);

fn note(app: &AppHandle, event: &str, detail: Option<&str>) {
    let _ = append_connector_diagnostic(app, FLAG, event, detail);
}

fn root(app: &AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "data_dir_unavailable")
}

/// A fresh flag (a plain file); a stale or future-dated one is removed here.
fn fresh_flag(path: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    let fresh = meta
        .modified()
        .ok()
        .and_then(|at| at.elapsed().ok())
        .is_some_and(|age| age <= FLAG_MAX_AGE);
    if !fresh {
        let _ = std::fs::remove_file(path);
    }
    fresh
}

/// Takes a fresh flag away, so a run never repeats itself.
fn take_flag(path: &Path) -> bool {
    fresh_flag(path) && std::fs::remove_file(path).is_ok()
}

/// Where the page is, as a refusal code; `Ok` only on the candidate's own profile.
fn check_page(url: &Url) -> Result<(), &'static str> {
    if url.scheme() != "https" || url.host_str() != Some("www.linkedin.com") {
        return Err("left_linkedin");
    }
    match url.path().split('/').find(|part| !part.is_empty()) {
        Some("in") => Ok(()),
        Some("checkpoint") => Err("checkpoint"),
        Some("login" | "uas" | "authwall" | "signup") => Err("signed_out"),
        _ => Err("page_changed"),
    }
}

fn slug_of(url: &Url) -> Option<String> {
    let mut parts = url.path().split('/').skip(1);
    (check_page(url).is_ok() && parts.next() == Some("in"))
        .then(|| parts.next())
        .flatten()
        .filter(|slug| !slug.is_empty())
        .map(str::to_lowercase)
}

/// `/in/<slug>/<form>` of this profile: the form's own page and nothing else.
fn is_form(url: &Url, slug: &str, form: &str) -> bool {
    slug_of(url).as_deref() == Some(slug)
        && url
            .path()
            .splitn(4, '/')
            .nth(3)
            .is_some_and(|rest| rest.starts_with(form))
}

fn state_script(wants_form: bool) -> String {
    STATE_SCRIPT.replace("__WANTS_FORM__", if wants_form { "true" } else { "false" })
}

/// `Ok` only on a page LinkedIn really served, with the form on it when one is due.
async fn check_served(window: &Webview, wants_form: bool) -> Result<(), &'static str> {
    match read_text(window, &state_script(wants_form)).await?.as_str() {
        "ok" => Ok(()),
        "form_missing" => Err("form_missing"),
        _ => Err("request_blocked"),
    }
}

fn link_script(form: &str) -> String {
    format!(
        "(function(){{var a=document.querySelector('a[href*=\"/{form}\"]');return a?a.href:'';}})()"
    )
}

async fn read_text(window: &Webview, script: &str) -> Result<String, &'static str> {
    for _ in 0..EVAL_TRIES {
        match eval_json(window, script).await {
            Ok(raw) => return serde_json::from_str(&raw).map_err(|_| "read_failed"),
            Err(error) if !is_transient_eval_error(&error) => return Err("read_failed"),
            Err(_) => tokio::time::sleep(Duration::from_secs(1)).await,
        }
    }
    Err("read_failed")
}

/// Still the same account, still hidden, and the page is where it should be.
fn still_ours(app: &AppHandle, window: &Webview, key: &str) -> Result<Url, &'static str> {
    if bound_account_key(app).as_deref() != Ok(key) {
        return Err("account_changed");
    }
    if is_session_window_on_screen(app, "linkedin") {
        return Err("session_in_use");
    }
    let url = window.url().map_err(|_| "session_closed")?;
    check_page(&url)?;
    Ok(url)
}

async fn capture(
    app: &AppHandle,
    window: &Webview,
    key: &str,
    folder: &Path,
) -> Result<(), &'static str> {
    tokio::time::sleep(PAGE_SETTLE).await;
    let profile = still_ours(app, window, key)?;
    let slug = slug_of(&profile)
        .filter(|slug| slug != "me")
        .ok_or("profile_unknown")?;
    check_served(window, false).await?;
    let mut links = Vec::new();
    for (name, form) in FORMS {
        let link = Url::parse(&read_text(window, &link_script(form)).await?)
            .ok()
            .filter(|url| is_form(url, &slug, form));
        if link.is_none() {
            note(app, "no_link", Some(name));
        }
        links.push((name, form, link));
    }
    for (name, form, link) in links {
        let Some(link) = link else { continue };
        tokio::time::sleep(FORM_PAUSE + pace_linkedin_navigation(app)).await;
        still_ours(app, window, key)?;
        window.navigate(link).map_err(|_| "navigate_failed")?;
        tokio::time::sleep(PAGE_SETTLE).await;
        if !is_form(&still_ours(app, window, key)?, &slug, form) {
            return Err("page_changed");
        }
        check_served(window, true).await?;
        let html = read_text(window, CAPTURE_SCRIPT).await?;
        if html.len() > MAX_HTML_BYTES {
            return Err("page_too_big");
        }
        std::fs::write(folder.join(format!("{name}.html")), html).map_err(|_| "write_failed")?;
        note(app, "saved", Some(name));
    }
    Ok(())
}

async fn run(app: &AppHandle, flag: &Path) -> Result<(), &'static str> {
    let label = session_window_label("linkedin").ok_or("session_closed")?;
    // Someone reads or signs in there now: the flag waits for the next start.
    if app.get_webview(label).is_some() {
        return Err("session_in_use");
    }
    if app.state::<AppState>().tunnel.is_running().await {
        return Err("tunnel_active");
    }
    let key = bound_account_key(app).map_err(|_| "account_changed")?;
    let folder = root(app)?.join("linkedin-study").join("forms");
    create_private_directory(&folder).map_err(|_| "write_failed")?;
    if !take_flag(flag) {
        return Err("flag_not_taken");
    }
    note(app, "started", None);
    tokio::time::sleep(pace_linkedin_navigation(app)).await;
    let request = SessionWindowRequest {
        platform: "linkedin".into(),
        url: PROFILE_URL.into(),
        layout: None,
        session_key: None,
        background: true,
    };
    if !open_session_window(app, &request, None).await.opened {
        return Err("not_opened");
    }
    let window = app.get_webview(label).ok_or("session_closed")?;
    let result = capture(app, &window, &key, &folder).await;
    if !is_session_window_on_screen(app, "linkedin") {
        close_session_window(app, "linkedin");
    }
    result
}

/// Called when the candidate's account is bound; without the flag it does nothing.
pub fn start_if_flagged(app: &AppHandle) {
    let Ok(flag) = root(app).map(|root| root.join("diagnostics").join(FLAG)) else {
        return;
    };
    if !fresh_flag(&flag) || RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(START_DELAY).await;
        match run(&app, &flag).await {
            Ok(()) => note(&app, "finished", None),
            Err(code) => note(&app, "stopped", Some(code)),
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("test url")
    }

    #[test]
    fn stops_on_sign_in_and_security_pages() {
        for (raw, code) in [
            (
                "https://www.linkedin.com/checkpoint/challenge/1",
                "checkpoint",
            ),
            ("https://www.linkedin.com/authwall?x=1", "signed_out"),
            ("https://www.linkedin.com/login", "signed_out"),
            ("https://www.linkedin.com/feed/", "page_changed"),
            ("https://evil.example/in/ivan/", "left_linkedin"),
        ] {
            assert_eq!(check_page(&url(raw)), Err(code), "{raw}");
        }
        assert_eq!(
            check_page(&url("https://www.linkedin.com/in/ivan/")),
            Ok(())
        );
    }

    #[test]
    fn opens_only_the_three_forms_of_a_profile() {
        for (_, form) in FORMS {
            assert!(is_form(
                &url(&format!("https://www.linkedin.com/in/ivan/{form}new/")),
                "ivan",
                form
            ));
        }
        for raw in [
            "https://www.linkedin.com/in/ivan/",
            "https://www.linkedin.com/in/ivan/edit/forms/education/new/",
            "https://www.linkedin.com/in/petr/edit/forms/summary/new/",
            "https://www.linkedin.com/company/in/x/edit/forms/summary/",
            "https://evil.example/in/ivan/edit/forms/summary/new/",
        ] {
            assert!(!is_form(&url(raw), "ivan", "edit/forms/summary/"), "{raw}");
        }
    }

    #[test]
    fn one_flag_is_one_run() {
        let flag = std::env::temp_dir().join(format!("oq-b802-{}", std::process::id()));
        assert!(!take_flag(&flag));
        std::fs::write(&flag, "").expect("flag");
        assert!(take_flag(&flag));
        assert!(!take_flag(&flag));
    }

    #[test]
    fn an_old_flag_is_removed_and_not_obeyed() {
        let flag = std::env::temp_dir().join(format!("oq-b802-old-{}", std::process::id()));
        let file = std::fs::File::create(&flag).expect("flag");
        let past = std::time::SystemTime::now() - FLAG_MAX_AGE - Duration::from_secs(1);
        file.set_modified(past).expect("mtime");
        assert!(!fresh_flag(&flag));
        assert!(!flag.exists());
    }

    #[test]
    fn the_scripts_only_read() {
        let scripts =
            FORMS.map(|(_, form)| link_script(form)).join("") + CAPTURE_SCRIPT + STATE_SCRIPT;
        for act in [
            "click(",
            "submit(",
            "dispatchEvent",
            ".value",
            "fetch(",
            "XMLHttpRequest",
        ] {
            assert!(!scripts.contains(act), "{act}");
        }
    }
}
