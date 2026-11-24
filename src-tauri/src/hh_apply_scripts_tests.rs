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
/// The mark React leaves on an element it runs.
const LIVE_BUTTON: &str =
    r#"document.querySelector('[data-qa="vacancy-response-link-top"]')['__reactProps$t'] = {};"#;
/// Below 1020 px hh hides the profile menu and shows the same mobile button to everyone.
const NARROW_HEADER: &str =
    r#"<button data-qa="mainmenu_anonMobileMenu-button" aria-label="navi-button-mobile"></button>"#;

#[test]
fn open_recognises_sign_in_in_the_wide_header() {
    let html = format!(
        r#"<div data-qa="mainmenu_applicantProfile">Профиль</div>{}{RESPONSE_BUTTON}"#,
        state("applicant")
    );
    let Some(result) = run(&html, LIVE_BUTTON, &[open_script("77")]) else {
        return;
    };
    assert_eq!(codes(&result), ["opened"]);
    assert_eq!(result["clicks"], json!(["vacancy-response-link-top"]));
}

#[test]
fn open_recognises_sign_in_in_the_narrow_header() {
    let html = format!("{NARROW_HEADER}{}{RESPONSE_BUTTON}", state("applicant"));
    let Some(result) = run(&html, LIVE_BUTTON, &[open_script("77")]) else {
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
        let Some(result) = run(&html, "", &[open_script("77")]) else {
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
    let Some(result) = run(&html, "", &[open_script("77")]) else {
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
        let Some(outcome) = run(&html, "", &[popup_script(Agreed::default()), result_script(Agreed::default())]) else {
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
    let script = resume_script("bbb222", None);
    let Some(result) = run(&html, "", &[script.clone(), script]) else {
        return;
    };
    assert_eq!(codes(&result), ["waiting", "resume_ok"]);
    assert_eq!(result["clicks"], json!(["resumeId"]));
    let Some(missing) = run(&html, "", &[resume_script("ccc333", None)]) else {
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
    let script = resume_script("bbb222", None);
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
    let Some(kept) = run(&html, DROPDOWN_SETUP, &[resume_script("aaa111", None)]) else {
        return;
    };
    assert_eq!(codes(&kept), ["resume_ok"]);
    assert_eq!(kept["clicks"], json!([]));
    let script = resume_script("aaa111", None);
    let steps = vec![script; 5];
    let Some(unknown) = run(&html, "", &steps) else {
        return;
    };
    assert_eq!(codes(&unknown).last().unwrap(), "resume_unknown");
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
        r#"<span data-qa="resume-title">Директор</span>
<textarea data-qa="vacancy-response-popup-form-letter-input"></textarea></form>
<button data-qa="vacancy-response-submit-popup" disabled>Откликнуться</button>"#,
    );
    let fill = "window.__oqResumeText = 'Директор';\
document.querySelector('textarea').value = 'Письмо';";
    let enable = "document.querySelector('button[disabled]').disabled = false;";
    let Some(blocked) = run(&html, fill, &[submit_script("abc123", "Письмо")]) else {
        return;
    };
    assert_eq!(codes(&blocked), ["waiting"]);
    assert_eq!(blocked["clicks"], json!([]));
    let Some(sent) = run(
        &html,
        &format!("{fill}{enable}"),
        &[submit_script("abc123", "Письмо")],
    ) else {
        return;
    };
    assert_eq!(codes(&sent), ["submitted"]);
    assert_eq!(sent["clicks"], json!(["vacancy-response-submit-popup"]));
    let Some(changed) = run(&html, enable, &[submit_script("abc123", "Письмо")]) else {
        return;
    };
    assert_eq!(codes(&changed), ["letter_not_kept"]);
    assert_eq!(changed["clicks"], json!([]));
}

#[test]
fn embeds_parameters_as_escaped_literals() {
    let script = letter_script("Строка\n\"кавычки\" </script> '); alert(1);//");
    assert!(script.contains(r#""Строка\n\"кавычки\" </script> '); alert(1);//""#));
    assert!(resume_script("abc123", None).contains(r#"var id="abc123";"#));
}

#[test]
fn stops_on_a_captcha_in_every_step() {
    for script in [
        open_script("77"),
        popup_script(Agreed::default()),
        resume_script("abc", None),
        letter_script("x"),
        submit_script("abc123", "x"),
    ] {
        assert!(script.contains("document.title"));
        assert!(script.contains("робот|человек"));
    }
    let Some(result) = run(
        r#"<div data-qa="captcha"></div>"#,
        "",
        &[
            open_script("77"),
            resume_script("abc", None),
            submit_script("abc123", "x"),
        ],
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

#[test]
fn open_waits_for_this_vacancy_and_presses_once() {
    let html = format!("{}{RESPONSE_BUTTON}", state("applicant"));
    // The window still shows /vacancy/77 while another vacancy was asked for.
    let Some(other) = run(&html, LIVE_BUTTON, &[open_script("7"), open_script("777")]) else {
        return;
    };
    assert_eq!(codes(&other), ["waiting", "waiting"]);
    assert_eq!(other["clicks"], json!([]));
    let steps = [open_script("77"), open_script("77")];
    let Some(once) = run(&html, LIVE_BUTTON, &steps) else {
        return;
    };
    assert_eq!(codes(&once), ["opened", "opened"]);
    assert_eq!(once["clicks"], json!(["vacancy-response-link-top"]));
}

#[test]
fn open_lets_react_take_the_button_over() {
    let html = format!("{}{RESPONSE_BUTTON}", state("applicant"));
    let steps = vec![open_script("77"); 20];
    let Some(result) = run(&html, "", &steps) else {
        return;
    };
    assert!(codes(&result).iter().all(|code| code == "page_not_ready"));
    assert_eq!(result["clicks"], json!([]));
}

/// hh.ru's bottom sheet (`MagrittePopup`): the card is a sibling of the form; a
/// press on it swaps card and form for a radio list. `readable`: React's props
/// can be read; `opens`: the card opens the list (hh.ru: more than one resume).
fn sheet_setup(shown: usize, titles: [&str; 2], readable: bool, opens: bool) -> String {
    format!(
        r#"
var resumes = [{{hash:'aaa111',title:[{{string:'{first}'}}]}},{{hash:'bbb222',title:[{{string:'{second}'}}]}}];
var root = document.createElement('div'); document.body.appendChild(root);
var tag = function (el, resume) {{ if ({readable}) el['__reactFiber$t'] = {{ memoizedProps: {{}}, return: {{ memoizedProps: {{ slot: {{ props: {{ resume: resume }} }} }}, return: null }} }}; }};
var card = function (resume) {{
  root.innerHTML = '<button data-qa="response-popup-close"></button><div id="card"><span data-qa="resume-title"></span></div><form id="RESPONSE_MODAL_FORM_ID"><textarea data-qa="vacancy-response-popup-form-letter-input">Письмо</textarea></form><button data-qa="vacancy-response-submit-popup"></button>';
  var title = root.querySelector('[data-qa="resume-title"]');
  title.textContent = resume.title[0].string; tag(title, resume);
  if ({opens}) root.querySelector('#card').addEventListener('click', list);
}};
var list = function () {{
  root.innerHTML = resumes.map(function (r) {{ return '<label><input type="radio" name="resumeId" value="' + r.hash + '"><span data-qa="resume-title">' + r.title[0].string + '</span></label>'; }}).join('');
  resumes.forEach(function (r) {{ root.querySelector('[value="' + r.hash + '"]').addEventListener('click', function () {{ card(r); }}); }});
}};
card(resumes[{shown}]);
"#,
        first = titles[0],
        second = titles[1],
    )
}

const COO: &str = "Операционный директор (COO)";

#[test]
fn sheet_keeps_the_requested_resume_outside_the_form() {
    let setup = sheet_setup(1, ["Директор", COO], true, true);
    let steps = [
        resume_script("bbb222", Some(COO)),
        submit_script("bbb222", "Письмо"),
        // The first answer was lost: asked again, not pressed again.
        submit_script("bbb222", "Письмо"),
    ];
    let Some(result) = run("", &setup, &steps) else {
        return;
    };
    assert_eq!(codes(&result), ["resume_ok", "submitted", "submitted"]);
    assert_eq!(result["clicks"], json!(["vacancy-response-submit-popup"]));
}

#[test]
fn sheet_switches_the_resume_in_its_list() {
    for (readable, titles) in [
        (true, ["Директор", COO]),
        (false, ["Директор", COO]),
        (true, [COO, COO]),
        (false, [COO, COO]),
    ] {
        let setup = sheet_setup(0, titles, readable, true);
        let script = resume_script("bbb222", None);
        let steps = [script.clone(), script.clone(), script];
        let Some(result) = run("", &setup, &steps) else {
            return;
        };
        assert_eq!(
            codes(&result),
            ["waiting", "waiting", "resume_ok"],
            "{readable} {titles:?}"
        );
        assert_eq!(result["clicks"], json!(["resume-title", "resumeId"]));
    }
}

#[test]
fn sheet_refuses_a_resume_missing_from_its_list() {
    let setup = sheet_setup(0, ["Директор", COO], true, true);
    let script = resume_script("ccc333", Some(COO));
    let Some(result) = run("", &setup, &[script.clone(), script]) else {
        return;
    };
    assert_eq!(codes(&result), ["waiting", "resume_not_found"]);
}

#[test]
fn a_unique_title_decides_only_without_a_readable_id() {
    let last = |shown, titles, readable, want: Option<&str>| {
        let setup = sheet_setup(shown, titles, readable, false);
        run("", &setup, &vec![resume_script("bbb222", want); 5])
            .map(|result| codes(&result).last().cloned().unwrap_or_default())
    };
    let Some(single) = last(1, ["Директор", COO], false, Some(COO)) else {
        return;
    };
    assert_eq!(single, "resume_ok");
    // Another title is shown, or the app could not vouch for the title.
    let cases = [
        (
            last(0, ["Директор", COO], false, Some(COO)),
            "resume_unknown",
        ),
        (last(1, ["Директор", COO], false, None), "resume_unknown"),
        // The id is readable and belongs to a resume with the same title.
        (last(0, [COO, COO], true, Some(COO)), "waiting"),
    ];
    for (code, expected) in cases {
        assert_eq!(code.as_deref(), Some(expected));
    }
}

#[test]
fn an_outdated_react_tree_never_confirms_a_resume() {
    let html = MODAL.replace(
        "</form>",
        r#"<span data-qa="resume-title">Директор</span></form>"#,
    );
    // The node still points at the previous tree, where the requested resume was chosen.
    let setup = |previous: &str| {
        format!(
            r#"var at = function (hash, title) {{ return {{ memoizedProps: {{ slot: {{ props: {{ resume: {{ hash: hash, title: [{{ string: title }}] }} }} }} }}, return: null }}; }};
var f = at('bbb222', '{previous}'); f.alternate = at('aaa111', 'Директор');
document.querySelector('[data-qa="resume-title"]')['__reactFiber$t'] = f;"#
        )
    };
    for previous in [COO, "Директор"] {
        let steps = vec![resume_script("bbb222", None); 5];
        let Some(result) = run(&html, &setup(previous), &steps) else {
            return;
        };
        assert!(
            !codes(&result).contains(&"resume_ok".to_string()),
            "{previous}"
        );
    }
}

#[test]
fn submit_stops_when_the_resume_changed_or_was_not_confirmed() {
    let setup = sheet_setup(0, ["Директор", COO], true, true);
    let submit = submit_script("bbb222", "Письмо");
    for confirmed in ["", "window.__oqResumeText='Директор';"] {
        let Some(result) = run("", &format!("{setup}{confirmed}"), &[submit.clone()]) else {
            return;
        };
        assert_eq!(codes(&result), ["resume_unknown"]);
        assert_eq!(result["clicks"], json!([]));
    }
}

#[test]
fn diagnostics_hold_flags_and_counts_only() {
    let setup = sheet_setup(1, ["Директор", COO], true, true);
    let html = format!("{}{RESPONSE_BUTTON}", state("applicant"));
    let Some(result) = run(
        &html,
        &setup,
        &[diagnostic_script("77"), diagnostic_script("7")],
    ) else {
        return;
    };
    assert_eq!(
        codes(&result),
        [
            "pv-s1-b1-m1-f1-l0-a1-x1-t1-r0-h1-n0",
            "po-s1-b1-m1-f1-l0-a1-x1-t1-r0-h1-n0"
        ]
    );
    assert_eq!(result["clicks"], json!([]));
}

#[test]
fn a_closed_vacancy_is_told_from_a_page_not_drawn_yet() {
    let closed = r#"<div data-qa="mainmenu_applicantProfile"></div><template id="HH-Lux-InitialState">{"userType":"applicant","vacancyView":{"vacancyFull":{"vacancy":{"status":{"archived":true,"disabled":false}}}}}</template>"#;
    let marked = r#"<div data-qa="mainmenu_applicantProfile"></div><span data-qa="vacancy-title-archived-text">в архиве</span>"#;
    let alive = closed.replace("true", "false");
    for (html, code) in [
        (closed, "vacancy_closed"),
        (marked, "vacancy_closed"),
        (alive.as_str(), "no_response_button"),
    ] {
        let Some(result) = run(html, "", &[open_script("77")]) else {
            return;
        };
        assert_eq!(codes(&result), [code], "{html}");
    }
}

#[test]
fn hh_questions_stop_until_the_candidate_agrees() {
    let html = r#"<button data-qa="relocation-warning-confirm">Да</button><button data-qa="countries-profile-visibility-popup-confirm">Да</button>"#;
    let setup = "document.addEventListener('click',function(e){e.target.remove();});";
    let both = Agreed {
        relocation: true,
        visibility: true,
    };
    let one = Agreed {
        relocation: true,
        visibility: false,
    };
    for (agreed, expected, clicks) in [
        (Agreed::default(), vec!["relocation_warning"; 3], 0),
        (
            one,
            vec!["waiting", "visibility_warning", "visibility_warning"],
            1,
        ),
        (both, vec!["waiting", "waiting", "waiting"], 2),
    ] {
        let script = popup_script(agreed);
        let Some(result) = run(html, setup, &[script.clone(), script.clone(), script]) else {
            return;
        };
        assert_eq!(codes(&result), expected);
        assert_eq!(result["clicks"].as_array().expect("clicks").len(), clicks);
    }
}

#[test]
fn a_submit_hh_held_back_is_pressed_once_more_and_only_then() {
    let agreed = Agreed {
        relocation: false,
        visibility: true,
    };
    let script = result_script(agreed);
    let form = r#"<button data-qa="vacancy-response-submit-popup">Откликнуться</button>"#;
    let asked = r#"<button data-qa="countries-profile-visibility-popup-confirm">Да</button>"#;
    let setup = "window.__oqSubmitted=1;document.addEventListener('click',function(e){if(/visibility/.test(e.target.getAttribute('data-qa')))e.target.remove();});";
    let many = vec![script; 12];
    let Some(held) = run(&format!("{form}{asked}"), setup, &many) else {
        return;
    };
    assert_eq!(
        held["clicks"],
        json!([
            "countries-profile-visibility-popup-confirm",
            "vacancy-response-submit-popup"
        ])
    );
    let Some(plain) = run(form, setup, &many) else {
        return;
    };
    assert_eq!(plain["clicks"], json!([]));
}
