//! B787: the employer's application form in a hidden window of the app.
//! Open → read fields → (the candidate answers on our screen) → fill → read
//! back → submit once after the candidate's confirmation → read the outcome.
//! Nothing here answers a CAPTCHA, signs in or alters how the window presents
//! itself; an outcome the board did not state is "unconfirmed", never "sent".
//! Field values are never written to diagnostics.

use crate::ats_form_scripts::script;
use crate::ats_target::{navigation_allowed, on_target, resolve, AtsTarget};
use crate::connector_session::{
    append_connector_diagnostic, candidate_store, eval_json, is_transient_eval_error,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const FORM_WINDOW_LABEL: &str = "connector-ats";
const WINDOW_SIZE: (f64, f64) = (920.0, 720.0);
const READ_WAIT: Duration = Duration::from_secs(25);
const FILL_WAIT: Duration = Duration::from_secs(40);
const OUTCOME_WAIT: Duration = Duration::from_secs(45);
const POLL: Duration = Duration::from_millis(500);
const MAX_ENTRIES: usize = 120;
const MAX_VALUE_CHARS: usize = 10_000;
const MAX_FILE_BASE64_CHARS: usize = 7_000_000;
const MAX_ID_CHARS: usize = 200;
/// Keeps the form's cookies apart from the hh.ru and LinkedIn sessions.
const STORE_MASK: [u8; 16] = *b"openqareer-ats-1";

pub(crate) type Values = BTreeMap<String, String>;

pub(crate) struct Run {
    pub(crate) vacancy_id: String,
    target: AtsTarget,
    /// What the form held right after filling; the candidate confirms these.
    pub(crate) filled: Option<Values>,
}

#[derive(Default)]
pub struct AtsFormState {
    pub(crate) run: Mutex<Option<Run>>,
    /// Vacancies whose submit button was pressed in this app run and not
    /// refused by the form: they are never pressed again.
    pressed: Mutex<HashSet<String>>,
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

pub(crate) fn is_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_CHARS && !value.chars().any(char::is_control)
}

pub fn validate_fill(request: &FillRequest) -> Result<(), String> {
    let sound = |entry: &Entry| {
        is_id(&entry.key)
            && entry.value.chars().count() <= MAX_VALUE_CHARS
            && entry.file.as_ref().is_none_or(|file| {
                is_id(&file.name) && is_id(&file.mime) && file.base64.len() <= MAX_FILE_BASE64_CHARS
            })
    };
    let files = request
        .entries
        .iter()
        .filter(|entry| entry.file.is_some())
        .count();
    if !is_id(&request.vacancy_id)
        || request.entries.is_empty()
        || request.entries.len() > MAX_ENTRIES
        || files > 2
        || !request.entries.iter().all(sound)
    {
        return Err("ats_fill_invalid".to_string());
    }
    Ok(())
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

/// What the board said after the press; silence is "unconfirmed".
pub fn outcome_of(last: &Value) -> (&'static str, Vec<String>) {
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
        Some("confirmed") => ("confirmed", Vec::new()),
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

pub(crate) fn values_of(snapshot: &Value) -> Values {
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
    window_location(app).is_some_and(|url| on_target(&target.hosts, url.as_str()))
}

pub fn close_form_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(FORM_WINDOW_LABEL) {
        let _ = window.destroy();
    }
    if let Ok(mut run) = app.state::<AtsFormState>().run.lock() {
        *run = None;
    }
}

fn build_window(app: &AppHandle, target: &AtsTarget) -> Result<(), String> {
    let (directory, account) = candidate_store(app)?;
    let directory = directory.join("ats");
    std::fs::create_dir_all(&directory).map_err(|_| "form_store_unavailable")?;
    let url = Url::parse(&target.entry_url).map_err(|_| "ats_address_invalid")?;
    let hosts = target.hosts.clone();
    WebviewWindowBuilder::new(app, FORM_WINDOW_LABEL, WebviewUrl::External(url))
        .title("OpenQareer")
        .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        // A hidden WKWebView keeps its timers only with this policy (B157).
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .on_navigation(move |next| navigation_allowed(&hosts, next.as_str()))
        .data_directory(directory)
        .data_store_identifier(store_identifier(account))
        .build()
        .map(|_| ())
        .map_err(|_| "form_window_build_failed".to_string())
}

pub(crate) fn form_report(target: &AtsTarget, form: Value, on_board: bool) -> FormReport {
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
    close_form_window(app);
    build_window(app, &target)?;
    {
        let state = app.state::<AtsFormState>();
        let mut run = state.run.lock().map_err(|_| "form_state_unavailable")?;
        *run = Some(Run {
            vacancy_id: request.vacancy_id,
            target: target.clone(),
            filled: None,
        });
    }
    let form = poll(app, "read", &Value::Null, READ_WAIT, |value| {
        value["state"] == "ready" && (value["submitButtons"] == 1 || value["step"] == "next")
    })
    .await?;
    let form = crate::ats_steps::with_menus(app, form).await;
    let report = form_report(&target, form, still_on_target(app, &target));
    note(app, "read", &format!("{}_{}", target.adapter, report.state));
    Ok(report)
}

pub async fn fill_form(app: &AppHandle, request: FillRequest) -> Result<FillReport, String> {
    validate_fill(&request)?;
    let target = current_target(app, &request.vacancy_id)?;
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
    let results: BTreeMap<String, String> = job["results"]
        .as_object()
        .map(|map| {
            map.iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap_or_default().to_string()))
                .collect()
        })
        .unwrap_or_default();
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
    outcome_of(&last)
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
    let state = app.state::<AtsFormState>();
    {
        // The refusal check and the mark are one step: two calls cannot both press.
        let filled = state.run.lock().map_err(|_| "form_state_unavailable")?;
        let mut pressed = state.pressed.lock().map_err(|_| "form_state_unavailable")?;
        let first = filled.as_ref().and_then(|run| run.filled.as_ref());
        let already = pressed.contains(&request.vacancy_id);
        if let Some(reason) = submit_refusal(&request, first, &second, already) {
            return Ok(receipt(app, "not_submitted", Some(reason), keys));
        }
        pressed.insert(request.vacancy_id.clone());
    }
    let press = page(app, "submit", &Value::Null).await;
    let clicked = press
        .as_ref()
        .is_ok_and(|value| value["state"] == "clicked");
    if !clicked {
        let reason = press
            .ok()
            .and_then(|value| value["state"].as_str().map(str::to_string))
            .unwrap_or_else(|| "press_unknown".to_string());
        // A press whose answer was lost may have happened: the mark stays.
        let refused = matches!(
            reason.as_str(),
            "captcha" | "submit_ambiguous" | "submit_disabled" | "form_missing"
        );
        if refused {
            if let Ok(mut pressed) = state.pressed.lock() {
                pressed.remove(&request.vacancy_id);
            }
        }
        let outcome = match (refused, reason.as_str()) {
            (true, "captcha") => "captcha",
            (true, _) => "not_submitted",
            (false, _) => "unconfirmed",
        };
        note(app, "submit", &format!("{}_{reason}", target.adapter));
        return Ok(receipt(app, outcome, Some(&reason), keys));
    }
    let pressed_at_ms = now_ms();
    let (outcome, invalid_keys) = read_outcome(app, &target, OUTCOME_WAIT).await;
    if outcome == "rejected" {
        // The form refused its own fields: nothing was sent, a corrected form may be.
        if let Ok(mut pressed) = state.pressed.lock() {
            pressed.remove(&request.vacancy_id);
        }
    }
    note(app, "submit", &format!("{}_{outcome}", target.adapter));
    Ok(Receipt {
        pressed_at_ms: Some(pressed_at_ms),
        invalid_keys,
        ..receipt(app, outcome, None, keys)
    })
}

/// A later look at the same window, e.g. after the candidate passed a check in it.
pub async fn read_form_outcome(app: &AppHandle, vacancy_id: &str) -> Result<Receipt, String> {
    let target = current_target(app, vacancy_id)?;
    let (outcome, invalid_keys) = read_outcome(app, &target, POLL).await;
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
        assert_eq!(outcome_of(&json!({ "state": "confirmed" })).0, "confirmed");
        assert_eq!(
            outcome_of(&json!({ "state": "invalid", "keys": ["id:email"] })),
            ("rejected", vec!["id:email".to_string()])
        );
        assert_eq!(outcome_of(&json!({ "state": "captcha" })).0, "captcha");
        for silent in [
            json!({ "state": "pending" }),
            Value::Null,
            json!({ "state": "script_failed" }),
        ] {
            assert_eq!(outcome_of(&silent).0, "unconfirmed");
        }
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
        let request = |entries: Vec<Entry>| FillRequest {
            vacancy_id: "v1".into(),
            entries,
        };
        assert!(validate_fill(&request(vec![entry("id:a", "x")])).is_ok());
        assert!(validate_fill(&request(Vec::new())).is_err());
        assert!(validate_fill(&request(vec![entry("", "x")])).is_err());
        assert!(validate_fill(&request(vec![entry(
            "id:a",
            &"x".repeat(MAX_VALUE_CHARS + 1)
        )]))
        .is_err());
        assert!(validate_fill(&request(vec![entry("id:a", "x"); MAX_ENTRIES + 1])).is_err());
        let account = [7u8; 16];
        assert_ne!(store_identifier(account), account);
        assert_eq!(decode(r#""{\"state\":\"ready\"}""#)["state"], "ready");
        assert_eq!(decode("not json"), Value::Null);
    }
}
