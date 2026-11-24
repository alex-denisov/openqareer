//! The response scripts run here against hh.ru markup reduced to what they
//! touch (taken from hh's bundles on 19.11.2026), in jsdom through Node. The
//! repository's `node_modules` holds jsdom after `npm ci`, which every CI job
//! that runs `cargo test` performs first.

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
  const { html, setup, scripts } = JSON.parse(input);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://hh.ru/vacancy/77' });
  const w = dom.window;
  // jsdom has no layout: an element is "on screen" unless it sits under [hidden].
  w.Element.prototype.getClientRects = function () {
    return this.closest('[hidden]') ? [] : [{}];
  };
  w.__clicks = [];
  w.document.addEventListener('click', (e) => {
    const t = e.target;
    w.__clicks.push(t.getAttribute('data-qa') || t.id || t.name || t.tagName);
  }, true);
  w.eval(setup || '');
  const codes = [];
  for (const script of scripts) {
    codes.push(w.eval(script).code);
    await new Promise((r) => setTimeout(r, 0));
  }
  const area = w.document.querySelector('textarea');
  process.stdout.write(JSON.stringify({ codes, clicks: w.__clicks, letter: area ? area.value : null }));
});
"#;

fn jsdom_path() -> Option<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let path = root.join("node_modules").join("jsdom");
    path.exists().then_some(path)
}

/// Runs `scripts` one after another on `html`; `None` only without Node/jsdom.
fn run(html: &str, setup: &str, scripts: &[String]) -> Option<Value> {
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
    let payload = json!({ "html": html, "setup": setup, "scripts": scripts });
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(payload.to_string().as_bytes())
        .expect("write");
    let output = child.wait_with_output().expect("node");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Some(serde_json::from_slice(&output.stdout).expect("harness json"))
}

fn codes(result: &Value) -> Vec<String> {
    result["codes"]
        .as_array()
        .expect("codes")
        .iter()
        .map(|code| code.as_str().unwrap_or_default().to_string())
        .collect()
}

fn state(user_type: &str) -> String {
    format!(
        r#"<template style="display:none" id="HH-Lux-InitialState">{{"account":{{}},"userType":"{user_type}"}}</template>"#
    )
}

const RESPONSE_BUTTON: &str =
    r##"<a data-qa="vacancy-response-link-top" href="#">Откликнуться</a>"##;
/// Below 1020 px hh hides the profile menu and shows the same mobile button to everyone.
const NARROW_HEADER: &str =
    r#"<button data-qa="mainmenu_anonMobileMenu-button" aria-label="navi-button-mobile"></button>"#;

#[test]
fn open_recognises_sign_in_in_the_wide_header() {
    let html = format!(
        r#"<div data-qa="mainmenu_applicantProfile">Профиль</div>{}{RESPONSE_BUTTON}"#,
        state("applicant")
    );
    let Some(result) = run(&html, "", &[open_script()]) else {
        return;
    };
    assert_eq!(codes(&result), ["opened"]);
    assert_eq!(result["clicks"], json!(["vacancy-response-link-top"]));
}

#[test]
fn open_recognises_sign_in_in_the_narrow_header() {
    let html = format!("{NARROW_HEADER}{}{RESPONSE_BUTTON}", state("applicant"));
    let Some(result) = run(&html, "", &[open_script()]) else {
        return;
    };
    assert_eq!(codes(&result), ["opened"]);
}

#[test]
fn open_stops_for_an_anonymous_visitor_at_any_width() {
    let narrow = format!("{NARROW_HEADER}{}{RESPONSE_BUTTON}", state("anonymous"));
    let wide = format!(
        r#"<a data-qa="mainmenu_profile-link mainmenu_loginButton">Войти</a>{}{RESPONSE_BUTTON}"#,
        state("anonymous")
    );
    let broken = format!(
        r#"{NARROW_HEADER}<template id="HH-Lux-InitialState">{{"userType":</template>{RESPONSE_BUTTON}"#
    );
    for html in [narrow, wide, broken] {
        let Some(result) = run(&html, "", &[open_script()]) else {
            return;
        };
        assert_eq!(codes(&result), ["not_signed_in"], "{html}");
        assert_eq!(result["clicks"], json!([]));
    }
}

#[test]
fn open_reports_an_existing_response_without_clicking() {
    let html = format!(
        r#"{NARROW_HEADER}{}<button data-qa="vacancy-response-link-view-topic">Вы откликнулись</button>"#,
        state("applicant")
    );
    let Some(result) = run(&html, "", &[open_script()]) else {
        return;
    };
    assert_eq!(codes(&result), ["already_applied"]);
    assert_eq!(result["clicks"], json!([]));
}

const MODAL: &str = r#"<div role="dialog"><button data-qa="response-popup-close"></button>
<form id="RESPONSE_MODAL_FORM_ID"></form></div>"#;

#[test]
fn recognises_the_live_response_modal_and_its_outcomes() {
    let cases = [
        (MODAL.to_string(), "popup", "waiting"),
        (
            format!(
                r#"{MODAL}<div data-qa="vacancy-response-success-standard-notification">Отклик отправлен</div>"#
            ),
            "already_applied",
            "sent",
        ),
        (
            r#"<button data-qa="vacancy-response-link-view-topic">Вы откликнулись</button>"#.into(),
            "already_applied",
            "sent",
        ),
        // Words in a vacancy description are not hh.ru's confirmation.
        (
            format!("{MODAL}<p>Резюме доставлено. Отклик отправлен.</p>"),
            "popup",
            "waiting",
        ),
        (
            r#"<button data-qa="relocation-warning-confirm">Всё равно откликнуться</button>"#
                .into(),
            "relocation_warning",
            "relocation_warning",
        ),
        (
            format!(r#"{MODAL}<div data-qa="vacancy-response-error-notification">Ошибка</div>"#),
            "hh_error",
            "hh_error",
        ),
        (String::new(), "waiting", "waiting"),
    ];
    for (html, popup, result) in cases {
        let Some(outcome) = run(&html, "", &[popup_script(), result_script()]) else {
            return;
        };
        assert_eq!(codes(&outcome), [popup, result], "{html}");
    }
}

#[test]
fn picks_the_resume_from_the_radio_list() {
    let html = MODAL.replace(
        "</form>",
        r#"<input type="radio" name="resumeId" value="aaa111" checked>
<input type="radio" name="resumeId" value="bbb222"></form>"#,
    );
    let Some(result) = run(&html, "", &[resume_script("bbb222")]) else {
        return;
    };
    assert_eq!(codes(&result), ["resume_ok"]);
    assert_eq!(result["clicks"], json!(["resumeId"]));
    let Some(missing) = run(&html, "", &[resume_script("ccc333")]) else {
        return;
    };
    assert_eq!(codes(&missing), ["resume_not_found"]);
}

/// The drop-down carries no id in markup: React props hold the resume shown
/// next to each title, and the chosen option replaces the trigger's resume.
const DROPDOWN_SETUP: &str = r#"
var fiberFor = function (hash) {
  return { memoizedProps: { type: 'title' }, return: { memoizedProps: { slot: { props: { resume: { hash: hash } } } }, return: null } };
};
var trigger = document.querySelector('#RESPONSE_MODAL_FORM_ID [data-qa="resume-title"]');
trigger['__reactFiber$test'] = fiberFor('aaa111');
trigger.addEventListener('click', function () {
  ['aaa111', 'bbb222'].forEach(function (hash) {
    var option = document.createElement('label');
    option.innerHTML = '<input type="radio" name="drop-' + hash + '"><span data-qa="resume-title">' + hash + '</span>';
    option.querySelector('span')['__reactFiber$test'] = fiberFor(hash);
    option.querySelector('input').addEventListener('click', function () {
      trigger['__reactFiber$test'] = fiberFor(hash);
    });
    document.body.appendChild(option);
  });
});
"#;

#[test]
fn switches_the_resume_in_the_drop_down() {
    let html = MODAL.replace(
        "</form>",
        r#"<div><span data-qa="resume-title">Директор</span></div></form>"#,
    );
    let script = resume_script("bbb222");
    let steps = [script.clone(), script.clone(), script];
    let Some(result) = run(&html, DROPDOWN_SETUP, &steps) else {
        return;
    };
    assert_eq!(codes(&result), ["waiting", "waiting", "resume_ok"]);
    assert_eq!(result["clicks"], json!(["resume-title", "drop-bbb222"]));
}

#[test]
fn keeps_a_preselected_resume_and_refuses_an_unreadable_one() {
    let html = MODAL.replace(
        "</form>",
        r#"<div><span data-qa="resume-title">Директор</span></div></form>"#,
    );
    let Some(kept) = run(&html, DROPDOWN_SETUP, &[resume_script("aaa111")]) else {
        return;
    };
    assert_eq!(codes(&kept), ["resume_ok"]);
    assert_eq!(kept["clicks"], json!([]));
    let Some(unknown) = run(&html, "", &[resume_script("aaa111")]) else {
        return;
    };
    assert_eq!(codes(&unknown), ["resume_unknown"]);
}

#[test]
fn opens_the_letter_field_once_and_types_the_letter() {
    let html = MODAL.replace(
        "</form>",
        r#"</form><button data-qa="add-cover-letter">Добавить сопроводительное</button>"#,
    );
    let setup = r#"document.querySelector('[data-qa="add-cover-letter"]').addEventListener('click', function () {
  setTimeout(function () {
    var box = document.createElement('div');
    box.setAttribute('data-qa', 'vacancy-response-popup-form-letter-input');
    box.appendChild(document.createElement('textarea'));
    document.querySelector('form').appendChild(box);
  }, 0);
});"#;
    let letter = "Добрый день!\r\n\r\nПишу по вакансии.  ";
    let steps = [
        letter_script(letter),
        letter_script(letter),
        letter_script(letter),
    ];
    let Some(result) = run(&html, setup, &steps) else {
        return;
    };
    assert_eq!(codes(&result), ["waiting", "letter_set", "letter_set"]);
    assert_eq!(result["clicks"], json!(["add-cover-letter"]));
    assert_eq!(result["letter"], json!("Добрый день!\n\nПишу по вакансии."));
}

#[test]
fn submits_only_an_enabled_form_that_still_holds_the_letter() {
    let html = MODAL.replace(
        "</form>",
        r#"<textarea data-qa="vacancy-response-popup-form-letter-input"></textarea></form>
<button data-qa="vacancy-response-submit-popup" disabled>Откликнуться</button>"#,
    );
    let fill = "document.querySelector('textarea').value = 'Письмо';";
    let enable = "document.querySelector('button[disabled]').disabled = false;";
    let Some(blocked) = run(&html, fill, &[submit_script("Письмо")]) else {
        return;
    };
    assert_eq!(codes(&blocked), ["waiting"]);
    assert_eq!(blocked["clicks"], json!([]));
    let Some(sent) = run(
        &html,
        &format!("{fill}{enable}"),
        &[submit_script("Письмо")],
    ) else {
        return;
    };
    assert_eq!(codes(&sent), ["submitted"]);
    assert_eq!(sent["clicks"], json!(["vacancy-response-submit-popup"]));
    let Some(changed) = run(&html, enable, &[submit_script("Письмо")]) else {
        return;
    };
    assert_eq!(codes(&changed), ["letter_not_kept"]);
    assert_eq!(changed["clicks"], json!([]));
}

#[test]
fn embeds_parameters_as_escaped_literals() {
    let script = letter_script("Строка\n\"кавычки\" </script> '); alert(1);//");
    assert!(script.contains(r#""Строка\n\"кавычки\" </script> '); alert(1);//""#));
    assert!(resume_script("abc123").contains(r#"var id="abc123";"#));
}

#[test]
fn stops_on_a_captcha_in_every_step() {
    for script in [
        open_script(),
        popup_script(),
        resume_script("abc"),
        letter_script("x"),
        submit_script("x"),
    ] {
        assert!(script.contains("document.title"));
        assert!(script.contains("робот|человек"));
    }
    let Some(result) = run(
        r#"<div data-qa="captcha"></div>"#,
        "",
        &[open_script(), resume_script("abc"), submit_script("x")],
    ) else {
        return;
    };
    assert_eq!(codes(&result), ["captcha", "captcha", "captcha"]);
}

#[test]
fn window_read_sees_only_a_response_to_this_vacancy() {
    let button = r#"<a data-qa="vacancy-response-link-top">Откликнуться</a>"#;
    let topic = r#"<button data-qa="vacancy-response-link-view-topic">Вы откликнулись</button>"#;
    let toast =
        r#"<div data-qa="vacancy-response-success-standard-notification">Отклик отправлен</div>"#;
    let cases = [
        (topic.to_string(), "77", "sent"),
        (toast.to_string(), "77", "sent"),
        // A title about a check is not a reason to miss the response.
        (
            format!("<title>Проверка качества</title>{topic}"),
            "77",
            "sent",
        ),
        // The page is another vacancy.
        (topic.to_string(), "7", "waiting"),
        (topic.to_string(), "777", "waiting"),
        // A response to a similar vacancy listed on this page.
        (format!("{button}{toast}"), "77", "waiting"),
        (format!("{button}{topic}"), "77", "waiting"),
        (
            "<p>Отклик отправлен. Вы откликнулись.</p>".into(),
            "77",
            "waiting",
        ),
    ];
    for (html, vacancy, code) in cases {
        let Some(result) = run(&html, "", &[window_script(vacancy)]) else {
            return;
        };
        assert_eq!(codes(&result), [code], "{vacancy} {html}");
        assert_eq!(result["clicks"], json!([]));
    }
}
