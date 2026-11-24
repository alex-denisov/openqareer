//! B787: the employer's application form in a hidden window of the app.
//! Open → read fields → (the candidate answers on our screen) → fill → read
//! back → submit once after the candidate's confirmation → read the outcome.
//! Nothing here answers a CAPTCHA, signs in or alters how the window presents
//! itself; an outcome the board did not state is "unconfirmed", never "sent".
//! Field values are never written to diagnostics.

use crate::ats_attempts::{self, Attempt, AttemptResult};
use crate::ats_files::validate_file;
use crate::ats_form_scripts::script;
use crate::ats_target::{is_confirmation, navigation_allowed, on_target, resolve, AtsTarget};
use crate::connector_session::{
    append_connector_diagnostic, candidate_store, candidate_store_of, eval_json,
    is_transient_eval_error,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
const READ_WAIT: Duration = Duration::from_secs(25);
const FILL_WAIT: Duration = Duration::from_secs(40);
const OUTCOME_WAIT: Duration = Duration::from_secs(45);
const POLL: Duration = Duration::from_millis(500);
const MAX_ENTRIES: usize = 120;
const MAX_VALUE_CHARS: usize = 10_000;
const MAX_FILES: usize = 2;
const MAX_CONSENTS: usize = 20;
const STORE_REMOVE_TRIES: u32 = 10;
const MAX_ID_CHARS: usize = 200;
/// Keeps the form's cookies apart from the hh.ru and LinkedIn sessions.
const STORE_MASK: [u8; 16] = *b"openqareer-ats-1";

/// What the page may answer instead of a press. Anything else is "press_unknown".
const PRESS_REFUSALS: &[&str] = &[
    "captcha",
    "submit_ambiguous",
    "submit_disabled",
    "form_missing",
];
const FILL_RESULTS: &[&str] = &[
    "set",
    "option_missing",
    "menu_missing",
    "field_missing",
    "file_missing",
    "file_not_attached",
];

type Values = BTreeMap<String, String>;
/// `accept` of every file field, by field key.
type FileFields = BTreeMap<String, Option<String>>;

struct Run {
    vacancy_id: String,
    target: AtsTarget,
    /// What the form held right after filling; the candidate confirms these.
    filled: Option<Values>,
    file_fields: FileFields,
    attempt: Option<Uuid>,
}

#[derive(Default)]
pub struct AtsFormState {
    run: Mutex<Option<Run>>,
    /// Held while the attempts file is read and written.
    attempts: Mutex<()>,
    /// Opening a form window and erasing its store never overlap.
    store: tokio::sync::Mutex<()>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenRequest {
    pub vacancy_id: String,
    pub url: String,
    #[serde(default)]
    pub board: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileValue {
    pub name: String,
    #[serde(rename = "type")]
    pub mime: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<FileValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FillRequest {
    pub vacancy_id: String,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmitRequest {
    pub vacancy_id: String,
    /// The candidate pressed «Отправить» on our screen for exactly these values.
    pub confirmed: bool,
    pub values: Values,
    /// Chosen by the cabinet and written to disk before the press.
    pub attempt_id: Uuid,
    /// Entries the cabinet already wrote to the consent journal for this attempt.
    #[serde(default)]
    pub consent_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FormReport {
    /// ready | account_required | form_missing | captcha | off_target | unreadable
    pub state: String,
    pub adapter: String,
    pub host: String,
    pub form: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FillReport {
    pub results: BTreeMap<String, String>,
    pub values: Values,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    /// confirmed | unconfirmed | rejected | captcha | not_submitted
    pub outcome: String,
    pub reason: Option<String>,
    pub host: String,
    pub path: String,
    pub pressed_at_ms: Option<u64>,
    /// Keys of the fields that were in the form when the button was pressed.
    pub field_keys: Vec<String>,
    /// Keys the form itself marked invalid.
    pub invalid_keys: Vec<String>,
}

fn is_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_CHARS && !value.chars().any(char::is_control)
}

fn validate_fill(request: &FillRequest, file_fields: &FileFields) -> Result<(), String> {
    let sound = |entry: &Entry| is_id(&entry.key) && entry.value.chars().count() <= MAX_VALUE_CHARS;
    let files = request
        .entries
        .iter()
        .filter(|entry| entry.file.is_some())
        .count();
    if !is_id(&request.vacancy_id)
        || request.entries.is_empty()
        || request.entries.len() > MAX_ENTRIES
        || files > MAX_FILES
        || !request.entries.iter().all(sound)
    {
        return Err("ats_fill_invalid".to_string());
    }
    for entry in &request.entries {
        if let Some(file) = &entry.file {
            let accept = file_fields
                .get(&entry.key)
                .ok_or("ats_file_field_unknown")?;
            validate_file(file, accept.as_deref())?;
        }
    }
    Ok(())
}

fn file_fields_of(form: &Value) -> FileFields {
    form["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|field| field["kind"] == "file")
        .filter_map(|field| {
            let accept = field["accept"].as_str().map(str::to_string);
            Some((field["key"].as_str()?.to_string(), accept))
        })
        .collect()
}

fn listed(value: Option<&str>, list: &[&'static str], other: &'static str) -> &'static str {
    list.iter()
        .find(|known| Some(**known) == value)
        .copied()
        .unwrap_or(other)
}

/// The press answer: `None` — pressed; otherwise why not, from the fixed list.
/// A press whose answer was lost may have happened.
fn press_refusal(press: Option<&Value>) -> Option<&'static str> {
    let state = press.and_then(|value| value["state"].as_str());
    (state != Some("clicked")).then(|| listed(state, PRESS_REFUSALS, "press_unknown"))
}

/// What the attempt on disk becomes after the board's answer.
fn attempt_result(outcome: &str) -> AttemptResult {
    match outcome {
        "confirmed" => AttemptResult::Sent,
        // The form refused its own fields: nothing was sent.
        "rejected" | "not_submitted" => AttemptResult::Failed,
        _ => AttemptResult::Unconfirmed,
    }
}

/// Why the button must not be pressed, if anything is off. `second` is the
/// read taken immediately before the press.
pub fn submit_refusal(
    request: &SubmitRequest,
    filled: Option<&Values>,
    second: &Values,
    already_pressed: bool,
) -> Option<&'static str> {
    if !request.confirmed {
        return Some("not_confirmed");
    }
    if already_pressed {
        return Some("already_submitted");
    }
    let Some(first) = filled else {
        return Some("form_not_filled");
    };
    if first != &request.values {
        return Some("confirmed_values_differ");
    }
    (second != first).then_some("form_changed")
}

/// What the board said after the press; silence is "unconfirmed". Only the
/// window's own address on the confirmation page confirms.
fn outcome_of(last: &Value, on_confirmation: bool) -> (&'static str, Vec<String>) {
    let keys = || {
        last["keys"]
            .as_array()
            .map(|keys| {
                keys.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    match last["state"].as_str() {
        Some("confirmed") if on_confirmation => ("confirmed", Vec::new()),
        Some("invalid") => ("rejected", keys()),
        Some("captcha") => ("captcha", Vec::new()),
        _ => ("unconfirmed", Vec::new()),
    }
}

fn store_identifier(account: [u8; 16]) -> [u8; 16] {
    let mut identifier = account;
    for (slot, mask) in identifier.iter_mut().zip(STORE_MASK) {
        *slot ^= mask;
    }
    identifier
}

fn decode(raw: &str) -> Value {
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::String(inner)) => serde_json::from_str(&inner).unwrap_or(Value::Null),
        Ok(value) => value,
        Err(_) => Value::Null,
    }
}

fn values_of(snapshot: &Value) -> Values {
    snapshot["values"]
        .as_object()
        .map(|map| {
            map.iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap_or_default().to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

fn note(app: &AppHandle, event: &str, detail: &str) {
    let _ = append_connector_diagnostic(app, "ats-form", event, Some(detail));
}

async fn page(app: &AppHandle, operation: &str, argument: &Value) -> Result<Value, String> {
    let window = app
        .get_webview(FORM_WINDOW_LABEL)
        .ok_or("form_window_missing")?;
    let raw = eval_json(&window, &script(operation, argument)?).await?;
    Ok(decode(&raw))
}

/// Repeats a read until `settled` accepts it or the wait runs out; the last
/// answer is returned either way.
async fn poll(
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

fn current_target(app: &AppHandle, vacancy_id: &str) -> Result<AtsTarget, String> {
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

fn still_on_target(app: &AppHandle, target: &AtsTarget) -> bool {
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
    action(&directory)
}

fn settle(app: &AppHandle, id: Uuid, outcome: &str) {
    let result = with_attempts(app, |directory| {
        ats_attempts::finish(directory, id, attempt_result(outcome))
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
    WebviewWindowBuilder::new(app, FORM_WINDOW_LABEL, WebviewUrl::External(url))
        .title("OpenQareer")
        .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        // A hidden WKWebView keeps its timers only with this policy (B157).
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .on_navigation(move |next| navigation_allowed(&allowed, next.as_str()))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_download(|_, event| !matches!(event, DownloadEvent::Requested { .. }))
        .data_directory(directory)
        .data_store_identifier(store_identifier(account))
        .build()
        .map(|_| ())
        .map_err(|_| "form_window_build_failed".to_string())
}

fn form_report(target: &AtsTarget, form: Value, on_board: bool) -> FormReport {
    let state = match form["state"].as_str() {
        _ if !on_board => "off_target",
        Some("ready") if form["captcha"] == true => "captcha",
        Some("ready") if form["unkeyed"].as_u64().unwrap_or(0) > 0 => "unreadable",
        Some(state @ ("ready" | "account_required" | "form_missing")) => state,
        _ => "unreadable",
    };
    FormReport {
        state: state.to_string(),
        adapter: target.adapter.to_string(),
        host: form["host"].as_str().unwrap_or_default().to_string(),
        form,
    }
}

pub async fn open_form(app: &AppHandle, request: OpenRequest) -> Result<FormReport, String> {
    if !is_id(&request.vacancy_id) {
        return Err("ats_open_invalid".to_string());
    }
    let target = resolve(&request.url, request.board.as_deref())?;
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
            attempt: None,
        });
    }
    let form = poll(app, "read", &Value::Null, READ_WAIT, |value| {
        value["state"] == "ready" && value["submitButtons"] == 1
    })
    .await?;
    if let Some(run) = state
        .run
        .lock()
        .map_err(|_| "form_state_unavailable")?
        .as_mut()
    {
        run.file_fields = file_fields_of(&form);
    }
    let report = form_report(&target, form, still_on_target(app, &target));
    note(app, "read", &format!("{}_{}", target.adapter, report.state));
    Ok(report)
}

pub async fn fill_form(app: &AppHandle, request: FillRequest) -> Result<FillReport, String> {
    let target = current_target(app, &request.vacancy_id)?;
    let file_fields = app
        .state::<AtsFormState>()
        .run
        .lock()
        .map_err(|_| "form_state_unavailable")?
        .as_ref()
        .map(|run| run.file_fields.clone())
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
    let argument = json!({ "confirmationPath": target.confirmation_path });
    let last = poll(app, "outcome", &argument, wait, |value| {
        matches!(
            value["state"].as_str(),
            Some("confirmed" | "invalid" | "captcha")
        )
    })
    .await
    .unwrap_or(Value::Null);
    if !still_on_target(app, target) {
        return ("unconfirmed", Vec::new());
    }
    let confirmed = window_location(app).is_some_and(|url| is_confirmation(target, url.as_str()));
    outcome_of(&last, confirmed)
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
        settle(app, attempt, "not_submitted");
        return Ok(receipt(app, "not_submitted", Some("off_target"), keys));
    }
    let press = page(app, "submit", &Value::Null).await.ok();
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
        settle(app, attempt, held);
        note(app, "submit", &format!("{}_{reason}", target.adapter));
        return Ok(receipt(app, outcome, Some(reason), keys));
    }
    let pressed_at_ms = now_ms();
    let (outcome, invalid_keys) = read_outcome(app, &target, OUTCOME_WAIT).await;
    settle(app, attempt, outcome);
    note(app, "submit", &format!("{}_{outcome}", target.adapter));
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
            settle(app, attempt, outcome);
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
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> Values {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn submit(confirmed: bool, pairs: &[(&str, &str)]) -> SubmitRequest {
        SubmitRequest {
            vacancy_id: "v1".into(),
            confirmed,
            values: values(pairs),
            attempt_id: Uuid::new_v4(),
            consent_ids: Vec::new(),
        }
    }

    #[test]
    fn the_button_is_pressed_only_for_confirmed_values_read_twice_the_same() {
        let filled = values(&[("id:email", "a@b.c"), ("id:resume", "cv.pdf:10")]);
        let same = [("id:email", "a@b.c"), ("id:resume", "cv.pdf:10")];
        assert_eq!(
            submit_refusal(&submit(true, &same), Some(&filled), &filled, false),
            None
        );
        let cases: [(SubmitRequest, Option<&Values>, Values, bool, &str); 5] = [
            (
                submit(false, &same),
                Some(&filled),
                filled.clone(),
                false,
                "not_confirmed",
            ),
            (
                submit(true, &same),
                Some(&filled),
                filled.clone(),
                true,
                "already_submitted",
            ),
            (
                submit(true, &same),
                None,
                filled.clone(),
                false,
                "form_not_filled",
            ),
            (
                submit(true, &[("id:email", "x@b.c"), ("id:resume", "cv.pdf:10")]),
                Some(&filled),
                filled.clone(),
                false,
                "confirmed_values_differ",
            ),
            (
                submit(true, &same),
                Some(&filled),
                values(&[("id:email", "a@b.c"), ("id:resume", "")]),
                false,
                "form_changed",
            ),
        ];
        for (request, first, second, pressed, reason) in cases {
            assert_eq!(
                submit_refusal(&request, first, &second, pressed),
                Some(reason)
            );
        }
    }

    #[test]
    fn only_the_board_s_own_statement_counts_as_sent() {
        let confirmed = json!({ "state": "confirmed" });
        assert_eq!(outcome_of(&confirmed, true).0, "confirmed");
        assert_eq!(outcome_of(&confirmed, false).0, "unconfirmed");
        assert_eq!(
            outcome_of(&json!({ "state": "invalid", "keys": ["id:email"] }), false),
            ("rejected", vec!["id:email".to_string()])
        );
        assert_eq!(
            outcome_of(&json!({ "state": "captcha" }), false).0,
            "captcha"
        );
        for silent in [
            json!({ "state": "pending" }),
            Value::Null,
            json!({ "state": "script_failed" }),
        ] {
            assert_eq!(outcome_of(&silent, true).0, "unconfirmed");
        }
    }

    #[test]
    fn a_reason_is_never_the_page_s_own_text() {
        let press = |state: &str| press_refusal(Some(&json!({ "state": state })));
        assert_eq!(press("clicked"), None);
        for known in PRESS_REFUSALS {
            assert_eq!(press(known), Some(*known));
        }
        assert_eq!(press("a@b.c <script>"), Some("press_unknown"));
        assert_eq!(press_refusal(None), Some("press_unknown"));
        assert_eq!(
            listed(Some("x"), FILL_RESULTS, "fill_failed"),
            "fill_failed"
        );
    }

    #[test]
    fn only_a_stated_refusal_frees_the_vacancy() {
        for (outcome, result) in [
            ("confirmed", AttemptResult::Sent),
            ("rejected", AttemptResult::Failed),
            ("not_submitted", AttemptResult::Failed),
            ("captcha", AttemptResult::Unconfirmed),
            ("unconfirmed", AttemptResult::Unconfirmed),
        ] {
            assert_eq!(attempt_result(outcome), result, "{outcome}");
        }
    }

    #[test]
    fn a_file_goes_only_into_a_file_field_the_page_had() {
        let form = json!({ "fields": [
            { "key": "id:resume", "kind": "file", "accept": ".pdf" },
            { "key": "id:email", "kind": "text", "accept": null },
        ] });
        let fields = file_fields_of(&form);
        assert_eq!(fields.len(), 1);
        let with = |key: &str, name: &str, mime: &str| FillRequest {
            vacancy_id: "v1".into(),
            entries: vec![Entry {
                key: key.into(),
                value: String::new(),
                file: Some(FileValue {
                    name: name.into(),
                    mime: mime.into(),
                    base64: "AAAA".into(),
                }),
            }],
        };
        let check = |request: FillRequest| validate_fill(&request, &fields);
        assert_eq!(
            check(with("id:resume", "cv.pdf", "application/pdf")),
            Ok(())
        );
        assert_eq!(
            check(with("id:email", "cv.pdf", "application/pdf")).unwrap_err(),
            "ats_file_field_unknown"
        );
        assert_eq!(
            check(with("id:resume", "cv.txt", "text/plain")).unwrap_err(),
            "ats_file_not_accepted"
        );
    }

    #[test]
    fn a_form_is_ready_only_on_its_board_fully_keyed_and_without_a_check() {
        let target = resolve("https://boards.greenhouse.io/acme/jobs/1", None).unwrap();
        let ready = json!({ "state": "ready", "host": "boards.greenhouse.io", "captcha": false, "unkeyed": 0 });
        assert_eq!(form_report(&target, ready.clone(), true).state, "ready");
        assert_eq!(
            form_report(&target, ready.clone(), false).state,
            "off_target"
        );
        let mut check = ready.clone();
        check["captcha"] = json!(true);
        assert_eq!(form_report(&target, check, true).state, "captcha");
        let mut loose = ready;
        loose["unkeyed"] = json!(1);
        assert_eq!(form_report(&target, loose, true).state, "unreadable");
        assert_eq!(form_report(&target, Value::Null, true).state, "unreadable");
        let sign_in = json!({ "state": "account_required", "host": "boards.greenhouse.io" });
        assert_eq!(
            form_report(&target, sign_in, true).state,
            "account_required"
        );
    }

    #[test]
    fn fill_input_is_bounded_and_the_store_is_not_the_shared_one() {
        let entry = |key: &str, value: &str| Entry {
            key: key.into(),
            value: value.into(),
            file: None,
        };
        let check = |request: FillRequest| validate_fill(&request, &FileFields::new());
        let request = |entries: Vec<Entry>| FillRequest {
            vacancy_id: "v1".into(),
            entries,
        };
        assert!(check(request(vec![entry("id:a", "x")])).is_ok());
        assert!(check(request(Vec::new())).is_err());
        assert!(check(request(vec![entry("", "x")])).is_err());
        assert!(check(request(vec![entry(
            "id:a",
            &"x".repeat(MAX_VALUE_CHARS + 1)
        )]))
        .is_err());
        assert!(check(request(vec![entry("id:a", "x"); MAX_ENTRIES + 1])).is_err());
        let account = [7u8; 16];
        assert_ne!(store_identifier(account), account);
        assert_eq!(decode(r#""{\"state\":\"ready\"}""#)["state"], "ready");
        assert_eq!(decode("not json"), Value::Null);
    }
}
