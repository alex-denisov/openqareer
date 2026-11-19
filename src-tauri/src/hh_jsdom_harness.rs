//! Test-only harness: runs fixed hh.ru page scripts in jsdom through Node,
//! against markup reduced to what the scripts touch.

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

pub(crate) const SIGNED_IN: &str =
    r#"<template id="HH-Lux-InitialState">{"userType":"applicant"}</template>"#;

fn jsdom_path() -> Option<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let path = root.join("node_modules").join("jsdom");
    path.exists().then_some(path)
}

pub(crate) fn run(html: &str, path: &str, setup: &str, scripts: &[String]) -> Option<Value> {
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

pub(crate) fn codes(value: &Value) -> Vec<String> {
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

pub(crate) fn clicks(value: &Value) -> Vec<String> {
    serde_json::from_value(value["clicks"].clone()).unwrap_or_default()
}
