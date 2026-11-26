use super::*;
use crate::hh_jsdom_harness::run;
use serde_json::Value;

const SRC: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COPY: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const LIST: &str = "/applicant/resumes";

fn codes(out: &Value) -> Vec<String> {
    out["results"]
        .as_array()
        .expect("results")
        .iter()
        .map(|result| {
            let parsed: Value = match result {
                Value::String(raw) => serde_json::from_str(raw).expect("json"),
                other => other.clone(),
            };
            parsed["code"].as_str().unwrap_or("none").to_string()
        })
        .collect()
}

fn clicks(out: &Value) -> Vec<String> {
    out["clicks"]
        .as_array()
        .expect("clicks")
        .iter()
        .map(|click| click.as_str().unwrap_or_default().to_string())
        .collect()
}

fn list() -> String {
    let card = |id: &str| {
        format!(
            r#"<div data-qa="resume"><a href="/resume/{id}">x</a><button data-qa="resume-list-action-more" name="{id}"></button></div>"#
        )
    };
    format!("{}{}<div id=drop></div>", card("other1"), card(SRC))
}

/// The menu hh.ru draws when a card's button is pressed.
fn menu(items: &str) -> String {
    format!(
        "document.addEventListener('click',function(e){{if(e.target.getAttribute('data-qa')==='resume-list-action-more'){{\
window.__card=e.target.name;document.getElementById('drop').innerHTML='{items}';}}}});"
    )
}

const FULL: &str = r#"<button data-qa="operations-list-edit-resume"></button><button data-qa="operations-list-duplicate-resume"></button>"#;

#[test]
fn copies_the_source_card_only_and_presses_once() {
    let steps = [
        menu_script(SRC),
        menu_script(SRC),
        duplicate_script(),
        duplicate_script(),
    ];
    let Some(out) = run(&list(), LIST, &menu(FULL), &steps) else {
        return;
    };
    assert_eq!(
        codes(&out),
        [
            "waiting",
            "menu_open",
            "duplicate_clicked",
            "duplicate_clicked"
        ]
    );
    assert_eq!(
        clicks(&out),
        [
            "resume-list-action-more",
            "operations-list-duplicate-resume"
        ]
    );
    let probe = "JSON.stringify({code:window.__card})".to_string();
    let steps = [menu_script(SRC), probe];
    let out = run(&list(), LIST, &menu(FULL), &steps).expect("jsdom");
    assert_eq!(codes(&out)[1], SRC);
}

#[test]
fn no_duplicate_item_means_the_limit_and_nothing_is_pressed() {
    let items = r#"<button data-qa="operations-list-edit-resume"></button>"#;
    let steps = [menu_script(SRC), menu_script(SRC), duplicate_script()];
    let Some(out) = run(&list(), LIST, &menu(items), &steps) else {
        return;
    };
    assert_eq!(codes(&out)[2], "limit_reached");
    assert_eq!(clicks(&out), ["resume-list-action-more"]);
}

#[test]
fn a_menu_opened_by_something_else_is_not_used() {
    let html = format!("{}{FULL}", list());
    let Some(out) = run(&html, LIST, "", &[menu_script(SRC), duplicate_script()]) else {
        return;
    };
    assert_eq!(codes(&out), ["menu_unexpected", "menu_missing"]);
    assert!(clicks(&out).is_empty());
}

#[test]
fn the_copy_is_the_one_unknown_id_in_the_address() {
    let known = vec![SRC.to_string()];
    let script = [landed_script(&known)];
    let at = |path: &str| run("", path, "", &script).map(|out| codes(&out)[0].clone());
    let Some(code) = at(&format!("/resume/edit/{COPY}/position")) else {
        return;
    };
    assert_eq!(code, "landed");
    assert_eq!(at(LIST).as_deref(), Some("waiting"));
    assert_eq!(at(&format!("/resume/{SRC}")).as_deref(), Some("waiting"));
    assert_eq!(
        at(&format!("/profile/resume/?resume={COPY}&from={SRC}")).as_deref(),
        Some("landed")
    );
    let limit = r#"<p data-qa="max-resume-limit-notification-text">20</p>"#;
    let out = run(limit, LIST, "", &script).expect("jsdom");
    assert_eq!(codes(&out), ["limit_reached"]);
}

fn editor(checked: &str, setka: bool) -> String {
    let card = |kind: &str| {
        let on = if kind == checked { "checked" } else { "" };
        format!(
            r#"<label data-qa="resume-visibility-card-access-type-{kind}"><input type="radio" name="{kind}" {on}></label>"#
        )
    };
    let on = if setka { "checked" } else { "" };
    format!(
        r#"{}{}<label data-qa="resume-visibility-setka-access-switch"><input type="checkbox" name="setka" {on}></label>"#,
        card("clients"),
        card("no_one")
    )
}

/// One radio group, as hh.ru's React state keeps it.
const RADIO: &str =
    "document.addEventListener('change',function(e){if(e.target.type!=='radio')return;\
document.querySelectorAll('input[type=radio]').forEach(function(r){r.checked=r===e.target;});});";

#[test]
fn hidden_is_only_no_one_with_setka_off() {
    let path = format!("/resume/edit/{COPY}/visibility");
    let read = |html: String| {
        run(&html, &path, "", &[visibility_script(&path)]).map(|out| codes(&out)[0].clone())
    };
    let Some(code) = read(editor("no_one", false)) else {
        return;
    };
    assert_eq!(code, "hidden");
    assert_eq!(read(editor("no_one", true)).as_deref(), Some("visible"));
    assert_eq!(read(editor("clients", false)).as_deref(), Some("visible"));
    assert_eq!(read(editor("", false)).as_deref(), Some("waiting"));
    assert_eq!(read(String::new()).as_deref(), Some("waiting"));
}

#[test]
fn hides_once_and_only_on_the_copys_editor() {
    let path = format!("/resume/edit/{COPY}/visibility");
    let steps = [
        hide_script(&path),
        hide_script(&path),
        hide_script(&path),
        visibility_script(&path),
    ];
    let Some(out) = run(&editor("clients", true), &path, RADIO, &steps) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting", "waiting", "chosen", "hidden"]);
    assert_eq!(clicks(&out), ["no_one", "setka"]);
    let other = format!("/resume/edit/{SRC}/visibility");
    let out = run(&editor("clients", true), &other, RADIO, &steps).expect("jsdom");
    assert_eq!(codes(&out)[0], "editor_missing");
    assert!(clicks(&out).is_empty());
}

#[test]
fn deletes_only_on_the_copys_page_after_its_own_question() {
    let html = r#"<button data-qa="resume-delete"></button><div id=drop></div>"#;
    let setup = "document.addEventListener('click',function(e){var k=e.target.getAttribute('data-qa');\
if(k==='resume-delete')document.getElementById('drop').innerHTML='<button data-qa=\"resume-delete-confirm\"></button>';\
if(k==='resume-delete-confirm')history.pushState({},'','/applicant/resumes');});";
    let steps = [
        delete_script(COPY),
        delete_script(COPY),
        delete_script(COPY),
    ];
    let Some(out) = run(html, &format!("/resume/{COPY}"), setup, &steps) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting", "waiting", "deleted"]);
    assert_eq!(clicks(&out), ["resume-delete", "resume-delete-confirm"]);
    let out = run(html, &format!("/resume/{SRC}"), setup, &steps).expect("jsdom");
    assert_eq!(codes(&out)[0], "editor_missing");
    assert!(clicks(&out).is_empty());
}

#[test]
fn waits_while_the_page_reloads_and_stops_without_sign_in() {
    let path = format!("/resume/edit/{COPY}/visibility");
    let steps = [visibility_script(&path)];
    let Some(out) = run(
        &editor("no_one", false),
        &path,
        "window.__oqStale=1;",
        &steps,
    ) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting"]);
    let anon = "document.getElementById('HH-Lux-InitialState').remove();";
    let out = run(&editor("no_one", false), &path, anon, &steps).expect("jsdom");
    assert_eq!(codes(&out), ["not_signed_in"]);
}

#[test]
fn the_list_without_the_profile_menu_still_counts_as_signed_in() {
    let anon = format!(
        "document.getElementById('HH-Lux-InitialState').remove();{}",
        menu(FULL)
    );
    let steps = [menu_script(SRC), menu_script(SRC)];
    let Some(out) = run(&list(), LIST, &anon, &steps) else {
        return;
    };
    assert_eq!(codes(&out), ["waiting", "menu_open"]);
    // A login form on the list, or any other page, still means a signed-out visitor.
    let login = format!(
        r#"{anon}document.body.insertAdjacentHTML('beforeend','<div data-qa="account-login-page"></div>');"#
    );
    let out = run(&list(), LIST, &login, &[menu_script(SRC)]).expect("jsdom");
    assert_eq!(codes(&out), ["not_signed_in"]);
    let out = run(&list(), "/vacancy/1", &anon, &[menu_script(SRC)]).expect("jsdom");
    assert_eq!(codes(&out), ["not_signed_in"]);
}
