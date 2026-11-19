//! The experience scripts run here in jsdom against hh.ru's profile list and
//! place form, reduced to what the scripts touch (from the
//! `resume-profile-front` bundles on 19.11.2026). The page's own behaviour
//! (opening forms, adding a card) is played by small click handlers.

use super::*;
use crate::hh_jsdom_harness::{clicks, codes, run};
use serde_json::{json, Value};

const HASH: &str = "abc123";
const OTHER: &str = "def456";
const PATH: &str = "/profile/resume/experience";
const WAS: &str = "Руководил отделом продаж из 12 человек, выстроил воронку";
const NOW: &str = "Вырастил выручку на 40 %\nВыстроил воронку B2B";

fn card(id: &str, employer: &str, position: &str, text: &str, checked: bool) -> String {
    format!(
        r#"<div data-qa="resume-profile-experience-checkable-item" id="{id}">
<input type="checkbox" data-qa="resume-profile-experience-checkable-item-checkbox"{}>
<div data-qa="company-name-title">{employer}</div><div data-qa="position-title">{position}</div>
<div data-qa="position-description">{text}</div>
<button data-qa="resume-profile-experience-checkable-item-edit">edit</button></div>"#,
        if checked { " checked" } else { "" }
    )
}

fn list(extra: &str) -> String {
    format!(
        r#"<div id="list">{}{}{extra}</div><button data-qa="list-add">Добавить</button>
<button data-qa="profile-layout-save-button">Сохранить</button><div id="modal"></div>"#,
        card(
            "c0",
            "ООО «Ромашка»",
            "Руководитель отдела продаж",
            WAS,
            true
        ),
        card("c1", "Лютик", "Менеджер", "Другое место", false),
    )
}

/// The place form and the page's reactions to clicks.
const PAGE: &str = r#"
const F = 'resume-profile-experience-specific-';
const form = (i, v, ticks) => `<div id="form">
<input data-qa="${F}company-input-${i}" value="${v.company}">
<input data-qa="${F}position-input-${i}" value="${v.position}">
<div data-qa="${F}datestart-month-input-${i}"><button>${v.sm}</button></div>
<input data-qa="${F}datestart-year-input-${i}" value="${v.sy}">
<div data-qa="${F}dateend-month-input-${i}"><button>${v.em}</button></div>
<input data-qa="${F}dateend-year-input-${i}" value="${v.ey}">
<input type="checkbox" data-qa="${F}now-checkbox-${i}">
<textarea data-qa="${F}responsibilities-input-${i}"></textarea>
<div><h3 data-qa="profile-education-resume-label">Резюме</h3>${ticks}</div>
<button data-qa="modal-edit-list-item-save">Сохранить</button>
<button data-qa="modal-edit-list-item-cancel">Отмена</button><div id="options"></div></div>`;
const tick = (hash, on, off) => `<label><input type="checkbox" name="${hash}" aria-label="r"${on ? ' checked' : ''}${off ? ' disabled' : ''}></label>`;
const modal = () => document.getElementById('modal');
const full = { company: 'ООО «Ромашка»', position: 'Руководитель отдела продаж', sm: 'Март', sy: '2019', em: 'Май', ey: '2023' };
const empty = { company: '', position: '', sm: '', sy: '', em: '', ey: '' };
window.__ticks = tick('abc123', true, true) + tick('def456', false, false);
document.addEventListener('click', (e) => {
  const qa = e.target.closest('[data-qa]') && e.target.closest('[data-qa]').getAttribute('data-qa');
  const button = e.target.closest('button');
  if (qa === 'resume-profile-experience-checkable-item-edit') modal().innerHTML = form(0, full, tick('abc123', true, false) + tick('def456', true, false));
  if (qa === 'modal-edit-list-item-cancel') modal().innerHTML = '';
  if (qa === 'list-add') modal().innerHTML = '<div><p>Какой опыт добавить?</p><button id="add-new">Добавить новый</button><button>Сохранить и продолжить</button></div>';
  if (button && button.id === 'add-new') modal().innerHTML = form(2, empty, window.__ticks);
  if (qa && qa.endsWith('-month-input-2')) document.getElementById('options').innerHTML =
    ['Январь', 'Март', 'Май'].map((m) => `<div role="option">${m}</div>`).join('');
  if (e.target.getAttribute('role') === 'option') {
    e.target.closest('#form').querySelector(`[data-qa$="${window.__open}"] button`).textContent = e.target.textContent;
  }
  if (qa && qa.endsWith('-month-input-2')) window.__open = qa.replace(/^.*(date(start|end)-month-input-2)$/, '$1');
  if (qa === 'modal-edit-list-item-save') {
    const text = document.querySelector('[data-qa$="responsibilities-input-2"]').value;
    modal().innerHTML = '';
    document.getElementById('list').insertAdjacentHTML('beforeend',
      `<div data-qa="resume-profile-experience-checkable-item" id="c2"><input type="checkbox" data-qa="resume-profile-experience-checkable-item-checkbox" checked>
<div data-qa="company-name-title">ООО «Ромашка»</div><div data-qa="position-title">Руководитель отдела продаж</div>
<div data-qa="position-description">${text}</div></div>`);
  }
  if (qa === 'profile-layout-save-button') history.pushState({}, '', '/resume/abc123');
}, true);
"#;

fn place() -> PlaceKey {
    PlaceKey {
        employer: "Ромашка".into(),
        position: "Руководитель отдела продаж".into(),
        was: WAS.into(),
    }
}

fn fields() -> PlaceFields {
    PlaceFields {
        company: "ООО «Ромашка»".into(),
        position: "Руководитель отдела продаж".into(),
        start_month: "Март".into(),
        start_year: "2019".into(),
        end_month: "Май".into(),
        end_year: "2023".into(),
        now: false,
    }
}

fn polled(script: String, times: usize) -> Vec<String> {
    std::iter::repeat_n(script, times).collect()
}

fn last_code(out: &Value) -> String {
    codes(out).last().cloned().unwrap_or_default()
}

#[test]
fn finds_the_original_place_ticked_for_this_resume() {
    let Some(out) = run(&list(""), PATH, PAGE, &[locate_script(&place())]) else {
        return;
    };
    assert_eq!(
        out["results"][0],
        json!({"code": "located", "checked": true, "locked": false})
    );
    let twin = card("c9", "Ромашка", "Руководитель отдела продаж", WAS, true);
    let Some(out) = run(&list(&twin), PATH, PAGE, &[locate_script(&place())]) else {
        return;
    };
    assert_eq!(codes(&out), ["place_ambiguous"]);
    let mut missing = place();
    missing.position = "Директор".into();
    let Some(out) = run(&list(""), PATH, PAGE, &[locate_script(&missing)]) else {
        return;
    };
    assert_eq!(codes(&out), ["place_not_found"]);
}

#[test]
fn copies_the_original_into_a_new_place_ticked_only_here_and_unticks_the_original() {
    let mut scripts = polled(read_original_script(&place()), 2);
    scripts.extend(polled(cancel_script(), 2));
    scripts.extend(polled(add_script(), 3));
    scripts.extend(polled(fill_script(&fields(), NOW, HASH), 8));
    scripts.extend(polled(item_save_script(HASH), 2));
    scripts.extend(polled(untick_script(&place()), 2));
    scripts.extend(polled(page_save_script(), 2));
    scripts.push("(function(){window.__oqStale=0;return {code:'reloaded'};})()".to_string());
    scripts.push(read_back_script(&place(), NOW));
    let Some(out) = run(&list(""), PATH, PAGE, &scripts) else {
        return;
    };
    let got = codes(&out);
    assert_eq!(got[1], "read");
    assert_eq!(
        serde_json::from_value::<PlaceFields>(out["results"][1]["fields"].clone()).ok(),
        Some(fields())
    );
    assert_eq!(got[3], "closed");
    assert_eq!(got[6], "form_open");
    assert_eq!(got[14], "filled", "{got:?}");
    assert_eq!(got[16], "item_saved");
    assert_eq!(got[18], "unticked");
    assert_eq!(got[20], "saved");
    assert_eq!(
        out["results"][22],
        json!({"code": "read", "added": true, "originalTicked": false})
    );
    let clicked = clicks(&out);
    assert_eq!(
        clicked
            .iter()
            .filter(|c| *c == "modal-edit-list-item-save")
            .count(),
        1
    );
    assert_eq!(
        clicked
            .iter()
            .filter(|c| *c == "profile-layout-save-button")
            .count(),
        1
    );
    assert!(
        !clicked.iter().any(|c| c == HASH || c == OTHER),
        "a resume tick was touched: {clicked:?}"
    );
    assert!(!clicked.iter().any(|c| c.contains("delete")));
}

#[test]
fn stops_before_saving_when_another_resume_is_ticked() {
    let setup =
        format!("{PAGE}window.__ticks = tick('abc123', true, true) + tick('def456', true, false);");
    let mut scripts = polled(add_script(), 3);
    scripts.extend(polled(fill_script(&fields(), NOW, HASH), 8));
    let Some(out) = run(&list(""), PATH, &setup, &scripts) else {
        return;
    };
    assert_eq!(last_code(&out), "other_resumes_ticked");
    assert!(!clicks(&out)
        .iter()
        .any(|c| c == "modal-edit-list-item-save"));
}

#[test]
fn stops_when_this_resume_is_not_the_ticked_one() {
    let setup = format!("{PAGE}window.__ticks = tick('zzz999', true, true);");
    let mut scripts = polled(add_script(), 3);
    scripts.push(fill_script(&fields(), NOW, HASH));
    let Some(out) = run(&list(""), PATH, &setup, &scripts) else {
        return;
    };
    assert_eq!(last_code(&out), "other_resumes_ticked");
}

#[test]
fn leaves_a_locked_original_alone() {
    let html = list("").replacen(
        r#"data-qa="resume-profile-experience-checkable-item-checkbox" checked"#,
        r#"data-qa="resume-profile-experience-checkable-item-checkbox" checked disabled"#,
        1,
    );
    let Some(out) = run(
        &html,
        PATH,
        PAGE,
        &[locate_script(&place()), untick_script(&place())],
    ) else {
        return;
    };
    assert_eq!(out["results"][0]["locked"], json!(true));
    assert_eq!(codes(&out)[1], "original_locked");
    assert!(clicks(&out).is_empty());
}

#[test]
fn stops_on_an_unknown_page_without_signing_in_or_with_a_captcha() {
    let Some(out) = run(
        "<p>Резюме</p>",
        PATH,
        "",
        &[locate_script(&place()), add_script()],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting", "waiting"]);
    let anon = "<script></script>";
    let Some(out) = run(
        anon,
        PATH,
        "document.getElementById('HH-Lux-InitialState').remove();",
        &[locate_script(&place())],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["not_signed_in"]);
}

#[test]
fn page_text_is_never_executed() {
    let mut hostile = place();
    hostile.employer = r#"");window.__pwned=1;(""#.into();
    let Some(out) = run(
        &list(""),
        PATH,
        "",
        &[
            locate_script(&hostile),
            fill_script(
                &fields(),
                r#"'});window.__pwned=1;({'"#,
                "abc123\"];window.__pwned=1;//",
            ),
            "(function(){return {code: String(window.__pwned||0)};})()".to_string(),
        ],
    ) else {
        return;
    };
    assert_eq!(last_code(&out), "0");
}

#[test]
fn checks_the_ticks_again_right_before_saving_the_place() {
    let mut scripts = polled(add_script(), 3);
    scripts.extend(polled(fill_script(&fields(), NOW, HASH), 8));
    scripts.push(
        "(function(){document.querySelector('input[name=\"def456\"]').checked=true;return {code:'ticked'};})()"
            .to_string(),
    );
    scripts.push(item_save_script(HASH));
    let Some(out) = run(&list(""), PATH, PAGE, &scripts) else {
        return;
    };
    assert_eq!(codes(&out)[10], "filled");
    assert_eq!(last_code(&out), "other_resumes_ticked");
    assert!(!clicks(&out)
        .iter()
        .any(|c| c == "modal-edit-list-item-save"));
}

#[test]
fn does_not_fill_or_save_a_form_it_did_not_open() {
    let html = format!("{}<div id=\"stray\"></div>", list(""));
    let setup = format!(
        "{PAGE}document.getElementById('modal').innerHTML = form(5, empty, window.__ticks);"
    );
    let scripts = [fill_script(&fields(), NOW, HASH), item_save_script(HASH)];
    let Some(out) = run(&html, PATH, &setup, &scripts) else {
        return;
    };
    assert_eq!(codes(&out), ["form_missing", "form_missing"]);
}

#[test]
fn every_step_waits_until_the_page_was_reloaded() {
    let Some(out) = run(
        &list(""),
        PATH,
        "window.__oqStale = 1;",
        &[
            locate_script(&place()),
            add_script(),
            item_save_script(HASH),
            read_back_script(&place(), NOW),
        ],
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting", "waiting", "waiting", "waiting"]);
    assert!(clicks(&out).is_empty());
}
