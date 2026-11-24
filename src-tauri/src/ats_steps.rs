//! B787: list options read from the page, and the pages of a multi-step form.
//! «Next» is pressed only for values the candidate confirmed and the page still
//! holds; the sending button is never pressed here (see `ats_apply::submit_form`).

use crate::ats_apply::{
    current_target, form_report, is_id, note, page, poll, still_on_target, values_of, AtsFormState,
    FormReport, SubmitRequest, Values,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const MENU_WAIT: Duration = Duration::from_secs(40);
const STEP_WAIT: Duration = Duration::from_secs(25);
/// Lists opened while the form is read; a longer form asks per field.
const MAX_MENUS: usize = 12;
const MAX_QUERY_CHARS: usize = 120;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionsRequest {
    pub vacancy_id: String,
    pub key: String,
    #[serde(default)]
    pub query: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepReport {
    /// moved | invalid | captcha | not_moved
    pub state: String,
    pub reason: Option<String>,
    pub invalid_keys: Vec<String>,
    /// The next page, once the form is on it.
    pub form: Option<FormReport>,
}

fn stopped(state: &str, reason: Option<&str>, keys: Vec<String>) -> StepReport {
    StepReport {
        state: state.to_string(),
        reason: reason.map(str::to_string),
        invalid_keys: keys,
        form: None,
    }
}

/// Keys of the lists whose options are not in the markup.
fn closed_menus(form: &Value) -> Vec<String> {
    form["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|field| field["kind"] == "combobox" && field["options"] == json!([]))
        .filter_map(|field| field["key"].as_str().map(str::to_string))
        .take(MAX_MENUS)
        .collect()
}

fn merge_menus(mut form: Value, menus: &Value) -> Value {
    for field in form["fields"].as_array_mut().into_iter().flatten() {
        let key = field["key"].as_str().unwrap_or_default();
        if let Some(options) = menus[key].as_array().filter(|list| !list.is_empty()) {
            field["options"] = json!(options);
        }
    }
    form
}

async fn read_menus(app: &AppHandle, requests: Value) -> Result<Value, String> {
    page(app, "options", &json!({ "requests": requests })).await?;
    let job = poll(app, "job", &Value::Null, MENU_WAIT, |value| {
        value["done"] == true
    })
    .await?;
    if job["done"] != true {
        return Err("options_timeout".to_string());
    }
    Ok(job["results"].clone())
}

/// The form with the options of its closed lists. A list that would not open
/// stays without options and is asked for by key.
pub(crate) async fn with_menus(app: &AppHandle, form: Value) -> Value {
    let keys = closed_menus(&form);
    if keys.is_empty() || form["captcha"] == true {
        return form;
    }
    let requests: Vec<Value> = keys.iter().map(|key| json!({ "key": key })).collect();
    match read_menus(app, json!(requests)).await {
        Ok(menus) => merge_menus(form, &menus),
        Err(reason) => {
            note(app, "options", &reason);
            form
        }
    }
}

/// Options of one list, narrowed by what the candidate typed.
pub async fn read_options(app: &AppHandle, request: OptionsRequest) -> Result<Value, String> {
    if !is_id(&request.key) || request.query.chars().count() > MAX_QUERY_CHARS {
        return Err("ats_options_invalid".to_string());
    }
    let target = current_target(app, &request.vacancy_id)?;
    if !still_on_target(app, &target) {
        return Err("off_target".to_string());
    }
    let menus = read_menus(app, json!([{ "key": request.key, "query": request.query }])).await?;
    Ok(menus[request.key.as_str()].clone())
}

/// Why «Next» must not be pressed: the same double check as the last page.
fn next_refusal(
    request: &SubmitRequest,
    filled: Option<&Values>,
    now: &Values,
) -> Option<&'static str> {
    crate::ats_apply::submit_refusal(request, filled, now, false)
}

pub async fn next_step(app: &AppHandle, request: SubmitRequest) -> Result<StepReport, String> {
    let target = current_target(app, &request.vacancy_id)?;
    if !still_on_target(app, &target) {
        return Ok(stopped("not_moved", Some("off_target"), Vec::new()));
    }
    let now = values_of(&page(app, "snapshot", &Value::Null).await?);
    let state = app.state::<AtsFormState>();
    {
        let mut run = state.run.lock().map_err(|_| "form_state_unavailable")?;
        let filled = run.as_ref().and_then(|run| run.filled.as_ref());
        if let Some(reason) = next_refusal(&request, filled, &now) {
            return Ok(stopped("not_moved", Some(reason), Vec::new()));
        }
        // The check is spent: a second press needs a new fill of its own page.
        if let Some(run) = run.as_mut() {
            run.filled = None;
        }
    }
    let press = page(app, "next", &Value::Null).await?;
    if press["state"] != "clicked" {
        let reason = press["state"].as_str().unwrap_or("press_unknown");
        let state = if reason == "captcha" {
            "captcha"
        } else {
            "not_moved"
        };
        return Ok(stopped(state, Some(reason), Vec::new()));
    }
    let argument = json!({ "signature": press["signature"] });
    let last = poll(app, "moved", &argument, STEP_WAIT, |value| {
        matches!(
            value["state"].as_str(),
            Some("moved" | "invalid" | "captcha")
        )
    })
    .await?;
    note(app, "next", last["state"].as_str().unwrap_or("unknown"));
    match last["state"].as_str() {
        Some("moved") => {
            let form = with_menus(app, last["form"].clone()).await;
            let on_board = still_on_target(app, &target);
            Ok(StepReport {
                form: Some(form_report(&target, form, on_board)),
                ..stopped("moved", None, Vec::new())
            })
        }
        Some("captcha") => Ok(stopped("captcha", None, Vec::new())),
        Some("invalid") => {
            let keys = last["keys"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|key| key.as_str().map(str::to_string))
                .collect();
            Ok(stopped("invalid", None, keys))
        }
        _ => Ok(stopped("not_moved", Some("no_answer"), Vec::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_closed_lists_are_opened_and_their_options_land_on_their_field() {
        let form = json!({ "fields": [
            { "key": "id:a", "kind": "combobox", "options": [] },
            { "key": "id:b", "kind": "select", "options": [] },
            { "key": "id:c", "kind": "combobox", "options": [{ "value": "x", "label": "x" }] },
        ] });
        assert_eq!(closed_menus(&form), ["id:a"]);
        let merged = merge_menus(form, &json!({ "id:a": [{ "value": "y", "label": "y" }] }));
        assert_eq!(merged["fields"][0]["options"][0]["label"], "y");
        assert_eq!(merged["fields"][2]["options"][0]["label"], "x");
    }

    #[test]
    fn a_page_is_left_only_with_confirmed_unchanged_values() {
        let values = |value: &str| Values::from([("id:a".to_string(), value.to_string())]);
        let request = |confirmed| SubmitRequest {
            vacancy_id: "v1".into(),
            confirmed,
            values: values("1"),
        };
        let ok = values("1");
        assert_eq!(next_refusal(&request(true), Some(&ok), &ok), None);
        assert!(next_refusal(&request(false), Some(&ok), &ok).is_some());
        assert!(next_refusal(&request(true), None, &ok).is_some());
        assert!(next_refusal(&request(true), Some(&ok), &values("2")).is_some());
    }
}
