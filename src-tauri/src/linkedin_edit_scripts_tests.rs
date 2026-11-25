//! Synthetic markup: LinkedIn's edit form has not been captured yet, so these
//! tests prove the refusals and the order of steps, not LinkedIn's layout.

use super::*;
use crate::hh_jsdom_harness::{clicks, codes, run_on};

const FORM: &str = "https://www.linkedin.com/in/me/edit/forms/summary/new/";

fn answers(html: &str, url: &str, scripts: &[String]) -> Option<serde_json::Value> {
    run_on(html, url, "", scripts)
}

#[test]
fn fills_the_only_field_and_presses_save_once() {
    let html = r#"<div role="dialog"><textarea id="t">Было</textarea>
<button id="cancel">Cancel</button><button id="save">Save</button></div>"#;
    let Some(out) = answers(
        html,
        FORM,
        &[
            fill_script("Было", "Стало\n\"два\""),
            save_script("Стало\n\"два\""),
            save_script("Стало\n\"два\""),
            read_script(),
            saved_script(),
        ],
    ) else {
        return;
    };
    assert_eq!(
        codes(&out),
        [
            "field_set",
            "save_clicked",
            "save_clicked",
            "read",
            "waiting"
        ]
    );
    assert_eq!(clicks(&out), ["save"]);
    assert_eq!(out["results"][3]["value"], "Стало\n\"два\"");
}

#[test]
fn refuses_every_unfamiliar_form_without_touching_it() {
    let text = "<textarea></textarea>";
    let save = "<button>Save</button>";
    for (html, expected) in [
        (format!("<div>{text}{text}{save}</div>"), "layout_unknown"),
        (format!("<div>{text}</div>"), "layout_unknown"),
        (format!("<div>{text}{save}{save}</div>"), "layout_unknown"),
        (
            format!("<div>{text}<input type=\"checkbox\">{save}</div>"),
            "layout_unknown",
        ),
        (
            format!("<div><textarea readonly></textarea>{save}</div>"),
            "field_locked",
        ),
        (
            format!("<div><textarea maxlength=\"2\"></textarea>{save}</div>"),
            "text_too_long",
        ),
        (format!("<div>{save}</div>"), "waiting"),
    ] {
        let Some(out) = answers(&html, FORM, &[fill_script("", "Текст")]) else {
            return;
        };
        assert_eq!(codes(&out), [expected], "{html}");
        assert!(clicks(&out).is_empty());
        assert_eq!(out["typed"].as_array().map(Vec::len), Some(0));
    }
}

#[test]
fn does_not_save_a_text_that_changed_after_filling() {
    let html = "<div><textarea>другое</textarea><button>Save</button></div>";
    let Some(out) = answers(html, FORM, &[save_script("Текст")]) else {
        return;
    };
    assert_eq!(codes(&out), ["field_not_kept"]);
    assert!(clicks(&out).is_empty());
}

#[test]
fn stops_on_sign_in_security_check_and_other_pages() {
    let html = "<div><textarea></textarea><button>Save</button></div>";
    for (url, expected) in [
        ("https://www.linkedin.com/checkpoint/challenge/1", "captcha"),
        ("https://www.linkedin.com/authwall", "not_signed_in"),
        ("https://www.linkedin.com/login", "not_signed_in"),
        (
            "https://www.linkedin.com/in/me/edit/intro/",
            "editor_missing",
        ),
        (
            "https://linkedin.com.evil.example/in/me/edit/forms/summary/new/",
            "target_redirect_rejected",
        ),
    ] {
        let Some(out) = answers(html, url, &[fill_script("", "Текст")]) else {
            return;
        };
        assert_eq!(codes(&out), [expected], "{url}");
    }
}

#[test]
fn takes_the_form_address_from_the_captured_profile_link() {
    let link = r#"<a componentkey="ivan_about_edit" aria-label="Edit about" href="/in/ivan/edit/forms/summary/new/"></a>"#;
    let Some(out) = answers(
        link,
        "https://www.linkedin.com/in/ivan/",
        &[edit_link_script()],
    ) else {
        return;
    };
    assert_eq!(
        out["results"][0]["value"],
        "https://www.linkedin.com/in/ivan/edit/forms/summary/new/"
    );
}

#[test]
fn does_not_replace_a_text_the_import_does_not_know() {
    let html = "<div><textarea>Своя новая правка</textarea><button>Save</button></div>";
    let Some(out) = answers(html, FORM, &[fill_script("Из импорта", "Стало")]) else {
        return;
    };
    assert_eq!(codes(&out), ["changed_since_import"]);
    assert_eq!(out["typed"].as_array().map(Vec::len), Some(0));
}
