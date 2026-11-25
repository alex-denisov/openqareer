//! B787: what the cabinet and the form window exchange, and the rules that need
//! no window: what may be filled, when the button may be pressed, what counts as sent.

use crate::ats_attempts::AttemptResult;
use crate::ats_files::validate_file;
use crate::ats_target::AtsTarget;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;

const MAX_ENTRIES: usize = 120;
const MAX_VALUE_CHARS: usize = 10_000;
const MAX_FILES: usize = 2;
pub(crate) const MAX_CONSENTS: usize = 20;
const MAX_ID_CHARS: usize = 200;
/// Keeps a path code within the sixty characters the journal takes.
const PATH_PARTS_MAX: usize = 4;
const PATH_WORDS: &[&str] = &[
    "application",
    "applications",
    "applied",
    "apply",
    "c",
    "candidates",
    "careers",
    "company",
    "confirmation",
    "connect",
    "errors",
    "j",
    "jobs",
    "new",
    "o",
    "oneclick-ui",
    "p",
    "postings",
    "publication",
    "submitted",
    "success",
    "thank-you",
    "thank_you",
    "thanks",
];

/// What the page may answer instead of a press. Anything else is "press_unknown".
pub(crate) const PRESS_REFUSALS: &[&str] = &[
    "captcha",
    "submit_ambiguous",
    "submit_disabled",
    "form_missing",
    "off_target",
];
pub(crate) const FILL_RESULTS: &[&str] = &[
    "set",
    "option_missing",
    "value_refused",
    "menu_missing",
    "field_missing",
    "file_missing",
    "file_not_attached",
    "upload_failed",
];

pub(crate) type Values = BTreeMap<String, String>;
/// `accept` of every file field, by field key.
pub(crate) type FileFields = BTreeMap<String, Option<String>>;

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

pub(crate) fn is_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID_CHARS && !value.chars().any(char::is_control)
}

pub(crate) fn validate_fill(request: &FillRequest, file_fields: &FileFields) -> Result<(), String> {
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

/// What the log says of fields the form did not take: kind and code, never a value.
pub(crate) fn rejected_fields(
    entries: &[Entry],
    results: &BTreeMap<String, String>,
    values: &Values,
    kinds: &BTreeMap<String, &'static str>,
) -> Vec<String> {
    entries
        .iter()
        .filter_map(|entry| {
            let result = results
                .get(&entry.key)
                .map_or("fill_failed", String::as_str);
            let given = entry.file.is_some() || !entry.value.is_empty();
            let empty = values.get(&entry.key).is_none_or(String::is_empty);
            let kind = kinds.get(&entry.key).copied().unwrap_or("unknown");
            match result {
                "set" if given && empty => Some(format!("{kind}_not_kept")),
                "set" => None,
                code => Some(format!("{kind}_{code}")),
            }
        })
        .collect()
}

const FIELD_KINDS: &[&str] = &[
    "text",
    "textarea",
    "email",
    "tel",
    "url",
    "number",
    "range",
    "date",
    "password",
    "select",
    "combobox",
    "radio",
    "checkbox",
    "checkbox_group",
    "file",
];

pub(crate) fn kinds_of(form: &Value) -> BTreeMap<String, &'static str> {
    form["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|field| {
            let kind = listed(field["kind"].as_str(), FIELD_KINDS, "unknown");
            Some((field["key"].as_str()?.to_string(), kind))
        })
        .collect()
}

pub(crate) fn file_fields_of(form: &Value) -> FileFields {
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

pub(crate) fn listed(
    value: Option<&str>,
    list: &[&'static str],
    other: &'static str,
) -> &'static str {
    list.iter()
        .find(|known| Some(**known) == value)
        .copied()
        .unwrap_or(other)
}

/// The press answer: `None` — pressed; otherwise why not, from the fixed list.
/// A press whose answer was lost may have happened.
pub(crate) fn press_refusal(press: Option<&Value>) -> Option<&'static str> {
    let state = press.and_then(|value| value["state"].as_str());
    (state != Some("clicked")).then(|| listed(state, PRESS_REFUSALS, "press_unknown"))
}

/// What the attempt on disk becomes after the board's answer.
pub(crate) fn attempt_result(outcome: &str) -> AttemptResult {
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

/// A refusal allows a new press only when the same form marked fields the app
/// had filled; anything else may hide an application that did leave.
pub(crate) fn rejection_of(
    before: &Values,
    after: Option<&Values>,
    invalid: &[String],
) -> &'static str {
    let same_form = after.is_some_and(|after| after.keys().eq(before.keys()));
    let filled = |key: &String| before.get(key).is_some_and(|value| !value.is_empty());
    if same_form && !invalid.is_empty() && invalid.iter().all(filled) {
        return "rejected";
    }
    "unconfirmed"
}

/// What the board said after the press; silence is "unconfirmed". Only the
/// window's own address on the confirmation page confirms.
pub(crate) fn outcome_of(last: &Value, on_confirmation: bool) -> (&'static str, Vec<String>) {
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

/// A path as one journal code. Only words the boards themselves use are kept;
/// a slug, an id or a token in it becomes `x`.
pub(crate) fn path_code(path: &str) -> String {
    let parts: Vec<&str> = path
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| {
            PATH_WORDS
                .iter()
                .find(|word| **word == part)
                .copied()
                .unwrap_or("x")
        })
        .take(PATH_PARTS_MAX)
        .collect();
    if parts.is_empty() {
        return "root".to_string();
    }
    parts.join("_")
}

pub(crate) fn decode(raw: &str) -> Value {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ats_apply::store_identifier;
    use crate::ats_target::resolve;
    use serde_json::json;

    #[test]
    fn a_path_becomes_a_journal_code_of_bounded_length() {
        assert_eq!(path_code("/jobs/8-x/applications"), "jobs_x_applications");
        assert_eq!(path_code("/applications/5f3a-token"), "applications_x");
        assert_eq!(path_code("/"), "root");
        let long = path_code(&"/confirmation".repeat(9));
        assert!(long.len() <= 60, "{long}");
    }

    #[test]
    fn a_refusal_stands_only_for_our_fields_of_the_same_form() {
        let before = values(&[("id:a", "x"), ("id:b", "")]);
        let invalid = |key: &str| vec![key.to_string()];
        let same = Some(&before);
        assert_eq!(rejection_of(&before, same, &invalid("id:a")), "rejected");
        for (after, keys) in [
            (same, Vec::new()),
            (same, invalid("id:b")),
            (same, invalid("id:other")),
            (None, invalid("id:a")),
            (Some(&values(&[("id:a", "x")])), invalid("id:a")),
        ] {
            assert_eq!(rejection_of(&before, after, &keys), "unconfirmed");
        }
    }

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
