//! B802: the fixed page scripts that put a new «О себе» into the candidate's
//! own LinkedIn profile.
//!
//! What is known from captures (B264 dumps, 23.09.2026): the profile page
//! carries `a[componentkey$="_about_edit"]` with the address of its edit form.
//! The form itself was never captured, so nothing here names its markup: the
//! scripts accept only a page with exactly one textarea and exactly one
//! «Save» in its container, and answer `layout_unknown` to anything else.
//! Until a live capture confirms that shape the runner is off in release builds.

use crate::hh_apply_scripts::literal;

const ABOUT_EDIT_LINK: &str = r#"a[componentkey$="_about_edit"]"#;

/// Shared prelude: sign-in and security checks are the candidate's, never ours.
fn wrap(body: &str) -> String {
    format!(
        "(function(){{try{{var path=location.pathname;\
if(!/(^|\\.)linkedin\\.com$/.test(location.hostname))return {{code:'target_redirect_rejected'}};\
if(/^\\/checkpoint(\\/|$)/.test(path)||document.querySelector('iframe[src*=\"captcha\"],#captcha-internal'))return {{code:'captcha'}};\
if(/^\\/(login|uas|authwall|signup)(\\/|$)/.test(path))return {{code:'not_signed_in'}};\
var seen=function(e){{return e.getClientRects().length>0;}};\
var all=function(root,s){{return Array.prototype.filter.call(root.querySelectorAll(s),seen);}};\
{body}}}catch(e){{return {{code:'script_error'}};}}}})()"
    )
}

/// The one editable field and the container that also holds «Save».
fn form() -> &'static str {
    "if(!/^\\/in\\/[^\\/]+\\/edit\\/forms\\/summary\\//.test(path))return {code:'editor_missing'};\
var boxes=all(document,'textarea');if(!boxes.length)return {code:'waiting'};\
if(boxes.length!==1)return {code:'layout_unknown'};\
var el=boxes[0];if(el.disabled||el.readOnly)return {code:'field_locked'};\
var saves=[],box=el.parentElement;\
for(;box&&box!==document.documentElement;box=box.parentElement){\
saves=all(box,'button').filter(function(b){return /^(save|сохранить)$/i.test(b.textContent.trim());});\
if(saves.length)break;}\
if(saves.length!==1||all(box,'input[type=\"checkbox\"],[role=\"switch\"]').length)return {code:'layout_unknown'};"
}

/// Polled on the candidate's profile: the address of the «О себе» edit form.
pub fn edit_link_script() -> String {
    wrap(&format!(
        "var a=document.querySelectorAll({link});if(!a.length)return {{code:'waiting'}};\
if(a.length!==1)return {{code:'layout_unknown'}};\
return {{code:'read',value:a[0].href}};",
        link = literal(ABOUT_EDIT_LINK),
    ))
}

/// Polled: puts `text` into the field.
pub fn fill_script(text: &str) -> String {
    wrap(&format!(
        "{form}if(el.maxLength>0&&{text}.length>el.maxLength)return {{code:'text_too_long'}};\
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,{text});\
el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));\
return {{code:el.value==={text}?'field_set':'field_not_kept'}};",
        form = form(),
        text = literal(text),
    ))
}

/// Polled: presses «Save» once, only while the field still holds `text`.
pub fn save_script(text: &str) -> String {
    wrap(&format!(
        "if(window.__oqLiSaved)return {{code:'save_clicked'}};\
{form}if(el.value!=={text})return {{code:'field_not_kept'}};\
if(el.getAttribute('aria-invalid')==='true')return {{code:'field_invalid'}};\
var b=saves[0];if(b.disabled||b.getAttribute('aria-disabled')==='true')return {{code:'waiting'}};\
window.__oqLiSaved=1;b.click();return {{code:'save_clicked'}};",
        form = form(),
        text = literal(text),
    ))
}

/// Polled after the press: LinkedIn closes the form once the save went through.
pub fn saved_script() -> String {
    wrap(
        "var left=all(document,'textarea');if(!left.length)return {code:'saved'};\
if(left[0].getAttribute('aria-invalid')==='true')return {code:'field_invalid'};return {code:'waiting'};",
    )
}

/// Reads the field back from a freshly opened form.
pub fn read_script() -> String {
    wrap(&format!("{}return {{code:'read',value:el.value}};", form()))
}

#[cfg(test)]
#[path = "linkedin_edit_scripts_tests.rs"]
mod tests;
