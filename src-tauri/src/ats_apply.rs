//! B787: the employer's application form in a hidden window of the app.
//! Open → read fields → (the candidate answers on our screen) → fill → read
//! back → submit once after the candidate's confirmation → read the outcome.
//! Nothing here answers a CAPTCHA, signs in or alters how the window presents
//! itself; an outcome the board did not state is "unconfirmed", never "sent".
//! Field values are never written to diagnostics.

use crate::ats_attempts::{self, Attempt, Confirmation};
use crate::ats_form_scripts::script;
use crate::ats_model::{
    attempt_result, decode, file_fields_of, form_report, is_id, kinds_of, listed, outcome_of,
    path_code, press_refusal, rejected_fields, rejection_of, submit_refusal, validate_fill,
    values_of, FileFields, FillReport, FillRequest, FormReport, OpenRequest, Receipt,
    SubmitRequest, Values, FILL_RESULTS, MAX_CONSENTS,
};
use crate::ats_target::{
    is_confirmation, navigation_allowed, on_target, resolve, thanks_in_place, thanks_paths,
    top_level_allowed, AtsTarget,
};
use crate::connector_session::{
    append_connector_diagnostic, candidate_store, candidate_store_of, eval_json,
    is_transient_eval_error,
};
use serde_json::{json, Value};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

pub const FORM_WINDOW_LABEL: &str = "connector-ats";
const WINDOW_SIZE: (f64, f64) = (920.0, 720.0);
const READ_WAIT: Duration = Duration::from_secs(45);
/// Reads in a row that find the same fields on a loaded page: boards draw late.
const STEADY_READS: usize = 3;
const FILL_WAIT: Duration = Duration::from_secs(90);
const OUTCOME_WAIT: Duration = Duration::from_secs(45);
const POLL: Duration = Duration::from_millis(500);
const STORE_REMOVE_TRIES: u32 = 10;
/// Keeps the form's cookies apart from the hh.ru and LinkedIn sessions.
const STORE_MASK: [u8; 16] = *b"openqareer-ats-1";

pub(crate) struct Run {
    pub(crate) vacancy_id: String,
    target: AtsTarget,
    /// What the form held right after filling; the candidate confirms these.
    pub(crate) filled: Option<Values>,
    pub(crate) file_fields: FileFields,
    /// Kinds of the fields read, for diagnostics.
    pub(crate) kinds: BTreeMap<String, &'static str>,
    attempt: Option<Uuid>,
    /// Fields the page had already marked when the button was pressed.
    invalid_before: Value,
}

#[derive(Default)]
pub struct AtsFormState {
    pub(crate) run: Mutex<Option<Run>>,
    /// Held while the attempts file is read and written.
    attempts: Mutex<()>,
    /// Opening a form window and erasing its store never overlap.
    store: tokio::sync::Mutex<()>,
}

pub(crate) fn store_identifier(account: [u8; 16]) -> [u8; 16] {
    let mut identifier = account;
    for (slot, mask) in identifier.iter_mut().zip(STORE_MASK) {
        *slot ^= mask;
    }
    identifier
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

pub(crate) fn note(app: &AppHandle, event: &str, detail: &str) {
    let _ = append_connector_diagnostic(app, "ats-form", event, Some(detail));
}

pub(crate) async fn page(
    app: &AppHandle,
    operation: &str,
    argument: &Value,
) -> Result<Value, String> {
    let window = app
        .get_webview(FORM_WINDOW_LABEL)
        .ok_or("form_window_missing")?;
    let raw = eval_json(&window, &script(operation, argument)?).await?;
    Ok(decode(&raw))
}

/// Repeats a read until `settled` accepts it or the wait runs out; the last
/// answer is returned either way.
pub(crate) async fn poll(
    app: &AppHandle,
    operation: &str,
    argument: &Value,
    wait: Duration,
    settled: impl Fn(&Value) -> bool,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + wait;
    let mut last = Value::Null;
    loop {
        match page(app, operation, argument).await {
            Ok(value) if settled(&value) => return Ok(value),
            Ok(value) => last = value,
            Err(error) if is_transient_eval_error(&error) => {}
            Err(error) => return Err(error),
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(last);
        }
        tokio::time::sleep(POLL).await;
    }
}

pub(crate) fn current_target(app: &AppHandle, vacancy_id: &str) -> Result<AtsTarget, String> {
    let state = app.state::<AtsFormState>();
    let run = state.run.lock().map_err(|_| "form_state_unavailable")?;
    run.as_ref()
        .filter(|run| run.vacancy_id == vacancy_id)
        .map(|run| run.target.clone())
        .ok_or_else(|| "form_not_open".to_string())
}

fn window_location(app: &AppHandle) -> Option<Url> {
    app.get_webview(FORM_WINDOW_LABEL)?.url().ok()
}

pub(crate) fn still_on_target(app: &AppHandle, target: &AtsTarget) -> bool {
    window_location(app).is_some_and(|url| on_target(target, url.as_str()))
}

pub fn close_form_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(FORM_WINDOW_LABEL) {
        let _ = window.destroy();
    }
    if let Ok(mut run) = app.state::<AtsFormState>().run.lock() {
        *run = None;
    }
}

fn attempts_directory(app: &AppHandle) -> Result<PathBuf, String> {
    candidate_store(app).map(|(directory, _)| directory)
}

/// Runs `action` on the bound candidate's attempts file, one caller at a time.
fn with_attempts<T>(
    app: &AppHandle,
    action: impl FnOnce(&std::path::Path) -> Result<T, String>,
) -> Result<T, String> {
    // Before the lock: a change of account holds its own lock and asks for ours.
    let directory = attempts_directory(app)?;
    let state = app.state::<AtsFormState>();
    let _guard = state
        .attempts
        .lock()
        .map_err(|_| "form_state_unavailable")?;
    let _held = ats_attempts::lock(&directory)?;
    action(&directory)
}

fn settle(app: &AppHandle, id: Uuid, outcome: &str, pressed_at_ms: Option<u64>) {
    let confirmation = (outcome == "confirmed").then(|| {
        let shown = receipt(app, outcome, None, Vec::new());
        Confirmation {
            host: shown.host,
            path: shown.path,
            pressed_at_ms,
        }
    });
    let result = with_attempts(app, |directory| {
        ats_attempts::finish(directory, id, attempt_result(outcome), confirmation)
    });
    // An unsettled attempt keeps blocking: the safe side.
    if result.is_err() {
        note(app, "attempt", "result_unrecorded");
    }
}

/// The last attempt for the vacancy, also after a restart of the app.
pub fn read_attempt(app: &AppHandle, vacancy_id: &str) -> Result<Option<Attempt>, String> {
    with_attempts(app, |directory| ats_attempts::latest(directory, vacancy_id))
}

/// Closes the form window and removes its cookies and files for the account.
/// The attempts stay: a candidate who returns must not apply twice.
pub async fn erase_form_store(app: &AppHandle, account_key: &str) -> Result<(), String> {
    let state = app.state::<AtsFormState>();
    let _guard = state.store.lock().await;
    let (directory, account) = candidate_store_of(app, account_key)?;
    let directory = directory.join("ats");
    let bound = candidate_store(app).is_ok_and(|(_, current)| current == account);
    if bound {
        close_form_window(app);
    }
    for _ in 0..STORE_REMOVE_TRIES {
        if app.get_webview(FORM_WINDOW_LABEL).is_none() {
            break;
        }
        tokio::time::sleep(POLL).await;
    }
    #[cfg(target_os = "macos")]
    {
        let identifier = store_identifier(account);
        let stores = app
            .fetch_data_store_identifiers()
            .await
            .map_err(|_| "form_store_unavailable")?;
        if stores.contains(&identifier) {
            app.remove_data_store(identifier)
                .await
                .map_err(|_| "form_store_not_erased")?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = account;
    remove_directory(&directory).await
}

/// WebView2 releases the folder a little after its window is gone.
async fn remove_directory(directory: &std::path::Path) -> Result<(), String> {
    for _ in 0..STORE_REMOVE_TRIES {
        match std::fs::remove_dir_all(directory) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => tokio::time::sleep(POLL).await,
        }
    }
    Err("form_store_not_erased".to_string())
}

/// Erasing for the candidate who is signed in now.
pub async fn erase_bound_form_store(app: &AppHandle) -> Result<(), String> {
    let key = crate::connector_session::bound_account_key(app)?;
    let erased = erase_form_store(app, &key).await;
    note(app, "erase", if erased.is_ok() { "done" } else { "failed" });
    erased
}

fn build_window(app: &AppHandle, target: &AtsTarget) -> Result<(), String> {
    let (directory, account) = candidate_store(app)?;
    let directory = directory.join("ats");
    std::fs::create_dir_all(&directory).map_err(|_| "form_store_unavailable")?;
    let url = Url::parse(&target.entry_url).map_err(|_| "ats_address_invalid")?;
    let allowed = target.clone();
    let top_level = target.clone();
    WebviewWindowBuilder::new(app, FORM_WINDOW_LABEL, WebviewUrl::External(url))
        .title("OpenQareer")
        .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        // A hidden WKWebView keeps its timers only with this policy (B157).
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .on_navigation(move |next| navigation_allowed(&allowed, next.as_str()))
        .on_page_load(move |window, payload| {
            if !top_level_allowed(&top_level, payload.url().as_str()) {
                note(window.app_handle(), "top_level", "refused");
                let _ = window.destroy();
            }
        })
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, event| !matches!(event, DownloadEvent::Requested { .. }))
        .data_directory(directory)
        .data_store_identifier(store_identifier(account))
        .build()
        .map(|_| ())
        .map_err(|_| "form_window_build_failed".to_string())
}

pub async fn open_form(app: &AppHandle, request: OpenRequest) -> Result<FormReport, String> {
    if !is_id(&request.vacancy_id) {
        return Err("ats_open_invalid".to_string());
    }
    let url = crate::ats_smartrecruiters::form_address(&request.url).await?;
    let target = resolve(&url, request.board.as_deref())?;
    let state = app.state::<AtsFormState>();
    {
        let _guard = state.store.lock().await;
        close_form_window(app);
        build_window(app, &target)?;
        let mut run = state.run.lock().map_err(|_| "form_state_unavailable")?;
        *run = Some(Run {
            vacancy_id: request.vacancy_id,
            target: target.clone(),
            filled: None,
            file_fields: FileFields::new(),
            kinds: BTreeMap::new(),
            attempt: None,
            invalid_before: Value::Null,
        });
    }
    read_page(app, &target).await
}

/// The page as it is now: an answer may have brought new questions onto it.
pub async fn read_form(app: &AppHandle, vacancy_id: &str) -> Result<FormReport, String> {
    let target = current_target(app, vacancy_id)?;
    if !still_on_target(app, &target) {
        return Err("off_target".to_string());
    }
    read_page(app, &target).await
}

/// A page whose load never ends is taken by its steady form alone after this.
const LOAD_WAIT: Duration = Duration::from_secs(15);

/// Says when the page has stopped drawing its form.
#[derive(Default)]
struct Steady {
    fields: Cell<usize>,
    reads: Cell<usize>,
}

impl Steady {
    fn settled(&self, form: &Value, waited: Duration) -> bool {
        let fields = form["fields"].as_array().map_or(0, Vec::len);
        let loaded = form["loaded"] == true || waited >= LOAD_WAIT;
        let same = fields > 0 && fields == self.fields.get() && loaded;
        self.reads.set(if same { self.reads.get() + 1 } else { 0 });
        self.fields.set(fields);
        form["state"] == "ready"
            && (form["submitButtons"] == 1 || form["step"] == "next")
            && self.reads.get() >= STEADY_READS
    }
}

async fn read_page(app: &AppHandle, target: &AtsTarget) -> Result<FormReport, String> {
    let steady = Steady::default();
    let opened = tokio::time::Instant::now();
    let form = poll(app, "read", &place_of(&target), READ_WAIT, move |value| {
        steady.settled(value, opened.elapsed())
    })
    .await?;
    if let Some(run) = app
        .state::<AtsFormState>()
        .run
        .lock()
        .map_err(|_| "form_state_unavailable")?
        .as_mut()
    {
        run.file_fields = file_fields_of(&form);
        run.kinds = kinds_of(&form);
    }
    let fields = kinds_of(&form).len();
    let form = crate::ats_steps::with_menus(app, form).await;
    let report = form_report(target, form, still_on_target(app, target));
    let detail = format!("{}_{}_fields{fields}", target.adapter, report.state);
    note(app, "read", &detail);
    Ok(report)
}

pub async fn fill_form(app: &AppHandle, request: FillRequest) -> Result<FillReport, String> {
    let target = current_target(app, &request.vacancy_id)?;
    let (file_fields, kinds) = app
        .state::<AtsFormState>()
        .run
        .lock()
        .map_err(|_| "form_state_unavailable")?
        .as_ref()
        .map(|run| (run.file_fields.clone(), run.kinds.clone()))
        .unwrap_or_default();
    validate_fill(&request, &file_fields)?;
    if !still_on_target(app, &target) {
        return Err("off_target".to_string());
    }
    page(app, "fill", &json!({ "entries": request.entries })).await?;
    let job = poll(app, "job", &Value::Null, FILL_WAIT, |value| {
        value["done"] == true
    })
    .await?;
    if job["done"] != true {
        return Err("fill_timeout".to_string());
    }
    let values = values_of(&page(app, "snapshot", &Value::Null).await?);
    let results: BTreeMap<String, String> = request
        .entries
        .iter()
        .map(|entry| {
            let result = listed(
                job["results"][&entry.key].as_str(),
                FILL_RESULTS,
                "fill_failed",
            );
            (entry.key.clone(), result.to_string())
        })
        .collect();
    let state = app.state::<AtsFormState>();
    if let Some(run) = state
        .run
        .lock()
        .map_err(|_| "form_state_unavailable")?
        .as_mut()
    {
        run.filled = Some(values.clone());
    }
    note(app, "fill", &format!("fields{}", results.len()));
    for rejected in rejected_fields(&request.entries, &results, &values, &kinds) {
        note(app, "fill_rejected", &rejected);
    }
    Ok(FillReport { results, values })
}

fn receipt(app: &AppHandle, outcome: &str, reason: Option<&str>, keys: Vec<String>) -> Receipt {
    let location = window_location(app);
    Receipt {
        outcome: outcome.to_string(),
        reason: reason.map(str::to_string),
        host: location
            .as_ref()
            .and_then(|url| url.host_str())
            .unwrap_or_default()
            .to_string(),
        path: location
            .map(|url| url.path().to_string())
            .unwrap_or_default(),
        pressed_at_ms: None,
        field_keys: keys,
        invalid_keys: Vec::new(),
    }
}

async fn read_outcome(
    app: &AppHandle,
    target: &AtsTarget,
    wait: Duration,
) -> (&'static str, Vec<String>) {
    let invalid_before = app
        .state::<AtsFormState>()
        .run
        .lock()
        .ok()
        .and_then(|run| run.as_ref().map(|run| run.invalid_before.clone()));
    let argument = json!({
        "confirmationPath": target.confirmation_path,
        "thanks": target.adapter,
        "thanksPaths": thanks_paths(target),
        "invalidBefore": invalid_before,
    });
    let last = poll(app, "outcome", &argument, wait, |value| {
        matches!(
            value["state"].as_str(),
            Some("confirmed" | "invalid" | "captcha")
        )
    })
    .await
    .unwrap_or(Value::Null);
    let confirmed = window_location(app).is_some_and(|url| {
        is_confirmation(target, url.as_str()) || thanks_in_place(target, url.as_str())
    });
    if !confirmed && !still_on_target(app, target) {
        return ("unconfirmed", Vec::new());
    }
    outcome_of(&last, confirmed)
}

/// Where the board left the window when it did not confirm: the path alone.
fn note_outcome(app: &AppHandle, event: &str, target: &AtsTarget, outcome: &str) {
    note(app, event, &format!("{}_{outcome}", target.adapter));
    if outcome == "unconfirmed" {
        let path = window_location(app).map(|url| path_code(url.path()));
        note(app, "unconfirmed_path", path.as_deref().unwrap_or("none"));
    }
}

/// Where the page must be at the moment of the press; the page checks it itself.
pub(crate) fn place_of(target: &AtsTarget) -> Value {
    let path = Url::parse(&target.entry_url)
        .map(|url| url.path().to_string())
        .unwrap_or_default();
    json!({ "hosts": target.hosts, "path": path })
}

pub async fn submit_form(app: &AppHandle, request: SubmitRequest) -> Result<Receipt, String> {
    let target = current_target(app, &request.vacancy_id)?;
    if !still_on_target(app, &target) {
        return Ok(receipt(
            app,
            "not_submitted",
            Some("off_target"),
            Vec::new(),
        ));
    }
    let second = values_of(&page(app, "snapshot", &Value::Null).await?);
    let keys: Vec<String> = second.keys().cloned().collect();
    let refused = begin_attempt(app, &request, &target, &second)?;
    if let Some(reason) = refused {
        return Ok(receipt(app, "not_submitted", Some(reason), keys));
    }
    let attempt = request.attempt_id;
    // The page may have moved on while the values were read and recorded.
    if !still_on_target(app, &target) {
        settle(app, attempt, "not_submitted", None);
        return Ok(receipt(app, "not_submitted", Some("off_target"), keys));
    }
    let press = page(app, "submit", &place_of(&target)).await.ok();
    if let Some(reason) = press_refusal(press.as_ref()) {
        let outcome = match reason {
            "press_unknown" => "unconfirmed",
            "captcha" => "captcha",
            _ => "not_submitted",
        };
        // A check shown before the press means there was no press.
        let held = if reason == "captcha" {
            "not_submitted"
        } else {
            outcome
        };
        settle(app, attempt, held, None);
        note(app, "submit", &format!("{}_{reason}", target.adapter));
        return Ok(receipt(app, outcome, Some(reason), keys));
    }
    let pressed_at_ms = now_ms();
    if let (Some(press), Ok(mut run)) = (press, app.state::<AtsFormState>().run.lock()) {
        if let Some(run) = run.as_mut() {
            run.invalid_before = press["invalidBefore"].clone();
        }
    }
    let (read, invalid_keys) = read_outcome(app, &target, OUTCOME_WAIT).await;
    let outcome = if read == "rejected" {
        let after = page(app, "snapshot", &Value::Null).await.ok();
        rejection_of(
            &second,
            after.as_ref().map(values_of).as_ref(),
            &invalid_keys,
        )
    } else {
        read
    };
    settle(app, attempt, outcome, Some(pressed_at_ms));
    note_outcome(app, "submit", &target, outcome);
    Ok(Receipt {
        pressed_at_ms: Some(pressed_at_ms),
        invalid_keys,
        ..receipt(app, outcome, None, keys)
    })
}

/// The refusal check and the record on disk are one step: two calls cannot both
/// press, and no press happens without a record.
fn begin_attempt(
    app: &AppHandle,
    request: &SubmitRequest,
    target: &AtsTarget,
    second: &Values,
) -> Result<Option<&'static str>, String> {
    if request.consent_ids.len() > MAX_CONSENTS {
        return Err("ats_submit_invalid".to_string());
    }
    let state = app.state::<AtsFormState>();
    with_attempts(app, |directory| {
        let mut run = state.run.lock().map_err(|_| "form_state_unavailable")?;
        let already = ats_attempts::is_blocked(directory, &request.vacancy_id, &target.entry_url)?;
        let first = run.as_ref().and_then(|run| run.filled.as_ref());
        if let Some(reason) = submit_refusal(request, first, second, already) {
            return Ok(Some(reason));
        }
        let attempt = Attempt {
            id: request.attempt_id,
            vacancy_id: request.vacancy_id.clone(),
            entry_url: target.entry_url.clone(),
            started_at_ms: now_ms(),
            consent_ids: request.consent_ids.clone(),
            result: None,
            confirmation: None,
        };
        match ats_attempts::begin(directory, attempt) {
            Ok(()) => {}
            Err(reason) if reason == "already_submitted" => return Ok(Some("already_submitted")),
            Err(_) => return Ok(Some("attempt_unrecorded")),
        }
        if let Some(run) = run.as_mut() {
            run.attempt = Some(request.attempt_id);
        }
        Ok(None)
    })
    .or_else(|error| match error.as_str() {
        "attempts_locked" => Ok(Some("attempt_unrecorded")),
        _ => Err(error),
    })
}

/// A later look at the same window, e.g. after the candidate passed a check in it.
pub async fn read_form_outcome(app: &AppHandle, vacancy_id: &str) -> Result<Receipt, String> {
    let target = current_target(app, vacancy_id)?;
    let (outcome, invalid_keys) = read_outcome(app, &target, POLL).await;
    if outcome == "confirmed" {
        let attempt = app
            .state::<AtsFormState>()
            .run
            .lock()
            .ok()
            .and_then(|run| run.as_ref().and_then(|run| run.attempt));
        if let Some(attempt) = attempt {
            settle(app, attempt, outcome, None);
        }
    }
    Ok(Receipt {
        invalid_keys,
        ..receipt(app, outcome, None, Vec::new())
    })
}

/// Puts the form window on screen. Called only for the candidate's own press.
pub fn show_form_window(app: &AppHandle, vacancy_id: &str) -> Result<bool, String> {
    current_target(app, vacancy_id)?;
    let Some(window) = app.get_webview_window(FORM_WINDOW_LABEL) else {
        return Ok(false);
    };
    let _ = window.center();
    Ok(window.show().is_ok() && window.set_focus().is_ok())
}

#[cfg(test)]
mod steady_tests {
    use super::*;

    #[test]
    fn the_form_is_taken_only_once_a_loaded_page_stops_adding_fields() {
        let form = |fields: usize, loaded: bool| {
            json!({ "state": "ready", "submitButtons": 1, "step": "submit", "loaded": loaded,
                    "fields": vec![json!({}); fields] })
        };
        let steady = Steady::default();
        for value in [
            form(7, false),
            form(7, false),
            form(7, true),
            form(18, true),
        ] {
            assert!(!steady.settled(&value, Duration::ZERO));
        }
        assert!(!steady.settled(&form(18, true), Duration::ZERO));
        assert!(!steady.settled(&form(18, true), Duration::ZERO));
        assert!(steady.settled(&form(18, true), Duration::ZERO));
        let empty = Steady::default();
        assert!((0..9).all(|_| !empty.settled(&form(0, true), LOAD_WAIT)));
    }

    #[test]
    fn a_page_that_never_finishes_loading_is_taken_by_its_steady_form() {
        let form = json!({ "state": "ready", "submitButtons": 1, "loaded": false, "fields": [{}] });
        let early = Steady::default();
        assert!((0..9).all(|_| !early.settled(&form, LOAD_WAIT - Duration::from_secs(1))));
        assert!(!early.settled(&form, LOAD_WAIT));
        assert!(!early.settled(&form, LOAD_WAIT));
        assert!(early.settled(&form, LOAD_WAIT));
    }
}
