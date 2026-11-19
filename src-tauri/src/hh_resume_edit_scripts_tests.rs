//! The resume edit scripts run here against hh.ru editor markup reduced to
//! what they touch (from hh's bundles on 19.11.2026), in jsdom through Node.

use super::*;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const HARNESS: &str = r#"
const { JSDOM } = require(process.env.OQ_JSDOM);
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', async () => {
  const { html, url, setup, scripts } = JSON.parse(input);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url });
  const w = dom.window;
  w.Element.prototype.getClientRects = function () {
    return this.closest('[hidden]') ? [] : [{}];
  };
  w.__clicks = [];
  w.__typed = [];
  w.document.addEventListener('click', (e) => {
    const t = e.target;
    w.__clicks.push(t.getAttribute('data-qa') || t.id || t.name || t.tagName);
  }, true);
  w.document.addEventListener('input', (e) => w.__typed.push(e.target.value), true);
  w.eval(setup || '');
  const results = [];
  for (const script of scripts) {
    results.push(w.eval(script));
    await new Promise((r) => setTimeout(r, 0));
  }
  process.stdout.write(JSON.stringify({ results, clicks: w.__clicks, typed: w.__typed }));
});
"#;

const SIGNED_IN: &str = r#"<template id="HH-Lux-InitialState">{"userType":"applicant"}</template>"#;
const HASH: &str = "abc123";

fn jsdom_path() -> Option<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let path = root.join("node_modules").join("jsdom");
    path.exists().then_some(path)
}

fn run(html: &str, path: &str, setup: &str, scripts: &[String]) -> Option<Value> {
    let Some(jsdom) = jsdom_path() else {
        eprintln!("jsdom missing: run `npm ci` in the repository root");
        return None;
    };
    let mut child = Command::new("node")
        .arg("-e")
        .arg(HARNESS)
        .env("OQ_JSDOM", jsdom)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let payload = json!({
        "html": format!("<!doctype html><html><body>{SIGNED_IN}{html}</body></html>"),
        "url": format!("https://hh.ru{path}"),
        "setup": setup,
        "scripts": scripts,
    });
    child
        .stdin
        .take()?
        .write_all(payload.to_string().as_bytes())
        .ok()?;
    let output = child.wait_with_output().ok()?;
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).ok()
}

fn codes(value: &Value) -> Vec<String> {
    value["results"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| item["code"].as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn clicks(value: &Value) -> Vec<String> {
    serde_json::from_value(value["clicks"].clone()).unwrap_or_default()
}

const SAVE: &str = r#"<button data-qa="resume-partial-edit-save">Сохранить</button>
<button data-qa="resume-partial-edit-cancel">Отменить</button>"#;

#[test]
fn sets_the_title_and_presses_save_once() {
    let path = edit_path(HASH, "position");
    let html = format!(r#"<input data-qa="resume-edit-title-suggest" value="Разработчик">{SAVE}"#);
    let Some(out) = run(
        &html,
        &path,
        "",
        &[
            field_script(&path, HH_EDIT_TITLE, "Senior Platform Engineer"),
            save_script(&path),
            save_script(&path),
            saved_script(&path),
        ],
    ) else {
        return;
    };
    assert_eq!(
        codes(&out),
        ["field_set", "save_clicked", "save_clicked", "waiting"]
    );
    assert_eq!(clicks(&out), ["resume-partial-edit-save"]);
    assert_eq!(out["typed"][0], "Senior Platform Engineer");
}

#[test]
fn sets_about_in_the_textarea_and_reads_it_back() {
    let path = edit_path(HASH, "about");
    let html = format!(r#"<textarea data-qa="resume-editor-about">Старый текст</textarea>{SAVE}"#);
    let text = "Строю операционные функции.\nВторая строка.";
    let Some(out) = run(
        &html,
        &path,
        "",
        &[
            field_script(&path, HH_EDIT_ABOUT, text),
            read_field_script(&path, HH_EDIT_ABOUT),
        ],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["field_set", "read"]);
    assert_eq!(out["results"][1]["value"], text);
}

#[test]
fn does_not_save_while_a_field_is_invalid_or_the_button_is_disabled() {
    let path = edit_path(HASH, "position");
    let invalid =
        format!(r#"<input data-qa="resume-edit-title-suggest" aria-invalid="true">{SAVE}"#);
    let disabled = r#"<input data-qa="resume-edit-title-suggest">
<button data-qa="resume-partial-edit-save" disabled>Сохранить</button>"#;
    let (Some(first), Some(second)) = (
        run(&invalid, &path, "", &[save_script(&path)]),
        run(disabled, &path, "", &[save_script(&path)]),
    ) else {
        return;
    };
    assert_eq!(codes(&first), ["field_invalid"]);
    assert_eq!(codes(&second), ["waiting"]);
    assert!(clicks(&first).is_empty() && clicks(&second).is_empty());
}

#[test]
fn stops_on_another_page_or_without_sign_in() {
    let path = edit_path(HASH, "position");
    let html = r#"<input data-qa="resume-edit-title-suggest">"#;
    let other = edit_path("zzz999", "position");
    let Some(out) = run(html, &other, "", &[field_script(&path, HH_EDIT_TITLE, "X")]) else {
        return;
    };
    assert_eq!(codes(&out), ["editor_missing"]);
    let setup = "document.getElementById('HH-Lux-InitialState').remove();";
    let Some(anon) = run(
        html,
        &path,
        setup,
        &[field_script(&path, HH_EDIT_TITLE, "X")],
    ) else {
        return;
    };
    assert_eq!(codes(&anon), ["not_signed_in"]);
}

#[test]
fn saved_once_hh_leaves_the_editor() {
    let path = edit_path(HASH, "keySkills");
    let Some(out) = run(
        "",
        &format!("/resume/edit/{HASH}/skillsLevels"),
        "",
        &[saved_script(&path)],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["saved"]);
}

/// The suggest shows the typed text as its own item once something was typed.
const SKILLS: &str = r#"<div data-qa="resume-editor-skills-input"><input></div>
<div class="chip">SQL<button data-qa="chip-delete-action">×</button></div>
<ul id="list"></ul>"#;
const SUGGEST_ON_TYPE: &str = r#"
document.querySelector('[data-qa="resume-editor-skills-input"] input').addEventListener('input', (e) => {
  document.getElementById('list').innerHTML = '<li data-qa="suggest-item-user-input">' + e.target.value + '</li>';
});
document.getElementById('list').addEventListener('click', (e) => {
  const item = e.target.closest('li');
  const chip = document.createElement('div');
  chip.innerHTML = item.textContent + '<button data-qa="chip-delete-action">×</button>';
  document.body.appendChild(chip);
  document.getElementById('list').innerHTML = '';
});
"#;

#[test]
fn adds_a_skill_through_the_suggest_typing_and_clicking_once() {
    let path = edit_path(HASH, "keySkills");
    let Some(out) = run(
        SKILLS,
        &path,
        SUGGEST_ON_TYPE,
        &[
            skill_script(&path, "Kubernetes"),
            skill_script(&path, "Kubernetes"),
            skill_script(&path, "Kubernetes"),
            read_skills_script(&path),
        ],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting", "waiting", "skill_present", "read"]);
    assert_eq!(clicks(&out), ["suggest-item-user-input"]);
    assert_eq!(out["results"][3]["values"], json!(["sql", "kubernetes"]));
}

#[test]
fn a_skill_already_chosen_is_left_alone_and_a_recommended_one_is_ticked() {
    let path = edit_path(HASH, "keySkills");
    let html = format!(
        r#"{SKILLS}<label><input type="checkbox" data-qa="resume-editor-skills-recommended-PostgreSQL"></label>"#
    );
    let Some(out) = run(
        &html,
        &path,
        "",
        &[
            skill_script(&path, "sql"),
            skill_script(&path, "PostgreSQL"),
            skill_script(&path, "PostgreSQL"),
        ],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["skill_present", "waiting", "skill_present"]);
    assert_eq!(
        clicks(&out),
        ["resume-editor-skills-recommended-PostgreSQL"]
    );
}

#[test]
fn never_presses_delete_or_cancel() {
    let path = edit_path(HASH, "keySkills");
    let html = format!("{SKILLS}{SAVE}");
    let Some(out) = run(
        &html,
        &path,
        SUGGEST_ON_TYPE,
        &[
            skill_script(&path, "dbt"),
            skill_script(&path, "dbt"),
            skill_script(&path, "dbt"),
            save_script(&path),
        ],
    ) else {
        return;
    };
    let pressed = clicks(&out);
    assert!(!pressed
        .iter()
        .any(|qa| qa == "chip-delete-action" || qa == "resume-partial-edit-cancel"));
}

#[test]
fn values_enter_only_as_string_literals() {
    let path = edit_path(HASH, "about");
    let hostile = "\");window.__pwned=1;(\"";
    let script = field_script(&path, HH_EDIT_ABOUT, hostile);
    assert!(script.contains(r#"\");window.__pwned=1;(\""#));
    let html = r#"<textarea data-qa="resume-editor-about"></textarea>"#;
    let Some(out) = run(
        html,
        &path,
        "",
        &[script, "({code:String(!!window.__pwned)})".into()],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["field_set", "false"]);
}

#[test]
fn maps_sections_to_editor_blocks() {
    assert_eq!(block_of("title"), Some("position"));
    assert_eq!(block_of("skills"), Some("keySkills"));
    assert_eq!(block_of("about"), Some("about"));
    assert_eq!(block_of("experience"), None);
    assert_eq!(edit_path("a1", "about"), "/resume/edit/a1/about");
}
