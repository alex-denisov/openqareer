//! B787: the fixed page scripts that copy one hh.ru resume, hide the copy from
//! everyone and, when it cannot be hidden, take that copy away again.
//!
//! Selectors come from hh.ru's shipped bundles on 26.11.2026 (`ApplicantMyResumes`,
//! `components-common-js`, `ResumeEditBlockVisibility`, `ApplicantView`); they were
//! not checked on a live account:
//! - the resume list: card `resume`, its menu `resume-list-action-more`, the item
//!   `operations-list-duplicate-resume` (absent when no resume is left in the limit);
//! - the visibility editor `/resume/edit/<hash>/visibility`: one label per access
//!   type, `resume-visibility-card-access-type-no_one` is «Не видно никому»; the
//!   Setka switch is `resume-visibility-setka-access-switch`;
//! - the resume page: `resume-delete`, then `resume-delete-confirm`.
//!
//! Only the card of the source resume is acted on when copying; hiding and deleting
//! act only on the page of the copy. Every script answers with a code and stops when
//! the page is not what it expects.

use crate::hh_apply_scripts::{literal, wrap};

pub const HH_CARD: &str = r#"[data-qa="resume"]"#;
pub const HH_CARD_MENU: &str = r#"[data-qa="resume-list-action-more"]"#;
pub const HH_MENU_ITEM: &str = r#"[data-qa^="operations-list-"]"#;
pub const HH_MENU_DUPLICATE: &str = r#"[data-qa="operations-list-duplicate-resume"]"#;
pub const HH_LIMIT_NOTICE: &str =
    r#"[data-qa="max-resume-limit-notification-text"], [data-qa="resumes-max-limit"]"#;
pub const HH_ACCESS_PREFIX: &str = "resume-visibility-card-access-type-";
pub const HH_ACCESS_NO_ONE: &str = "no_one";
pub const HH_SETKA_SWITCH: &str = r#"[data-qa="resume-visibility-setka-access-switch"]"#;
pub const HH_DELETE: &str = r#"[data-qa="resume-delete"], [data-qa="resume-delete-button"]"#;
pub const HH_DELETE_CONFIRM: &str = r#"[data-qa="resume-delete-confirm"]"#;

/// Waits out a page that is being reloaded and one without a sign-in.
const GUARD: &str =
    "if(window.__oqStale)return {code:'waiting'};if(!signedIn())return {code:'not_signed_in'};\
var shown=function(e){return !!(e&&e.getClientRects().length);};\
var all=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s)).filter(shown);};\
var st=window.__oqCopy=window.__oqCopy||{};";

/// The list may be on screen as `/applicant/resumes` or, after a redirect, the profile.
const ON_LIST: &str = "/^\\/applicant\\/(resumes|profile)(\\/|$)/.test(location.pathname)";

/// Polled on the list: opens the menu of the source's card, of no other one, once.
pub fn menu_script(source_id: &str) -> String {
    wrap(&format!(
        "{GUARD}if(!{ON_LIST})return {{code:'waiting'}};var S={source};\
var mine=all({card}).filter(function(c){{\
var ids=Array.prototype.map.call(c.querySelectorAll('a[href]'),function(a){{\
var m=/^\\/resume\\/([A-Za-z0-9]+)\\/?$/.exec(a.pathname);return m?m[1]:null;}}).filter(Boolean);\
return ids.length>0&&ids.every(function(id){{return id===S;}});}});\
if(mine.length===0)return {{code:'waiting'}};if(mine.length>1)return {{code:'source_ambiguous'}};\
if(all({item}).length>0)return {{code:st.menu?'menu_open':'menu_unexpected'}};\
var more=all({more},mine[0]);if(more.length!==1)return {{code:'waiting'}};\
if(!st.menu){{st.menu=1;more[0].click();}}return {{code:'waiting'}};",
        source = literal(source_id),
        card = literal(HH_CARD),
        item = literal(HH_MENU_ITEM),
        more = literal(HH_CARD_MENU),
    ))
}

/// Polled: presses «Дублировать» in the menu this run opened, once.
pub fn duplicate_script() -> String {
    wrap(&format!(
        "{GUARD}if(st.duplicated)return {{code:'duplicate_clicked'}};\
if(!st.menu||!{ON_LIST})return {{code:'menu_missing'}};\
if(all({item}).length===0)return {{code:'waiting'}};var d=all({duplicate});\
if(d.length===0)return {{code:'limit_reached'}};if(d.length>1)return {{code:'menu_unexpected'}};\
if(d[0].disabled||d[0].getAttribute('aria-disabled')==='true')return {{code:'waiting'}};\
st.duplicated=1;d[0].click();return {{code:'duplicate_clicked'}};",
        item = literal(HH_MENU_ITEM),
        duplicate = literal(HH_MENU_DUPLICATE),
    ))
}

/// Polled after the press: hh.ru opens the new resume; its id is in the address
/// and is none of the known ones.
pub fn landed_script(known_ids: &[String]) -> String {
    let known = serde_json::to_string(known_ids).unwrap_or_else(|_| "[]".into());
    wrap(&format!(
        "{GUARD}var K={known};if(all({limit}).length>0)return {{code:'limit_reached'}};\
var ids=((location.pathname+location.search).match(/[0-9a-f]{{30,64}}/g)||[]);\
var fresh=ids.filter(function(id,i){{return K.indexOf(id)<0&&ids.indexOf(id)===i;}});\
if(fresh.length>1)return {{code:'copy_ambiguous'}};\
return fresh.length===1?{{code:'landed',value:fresh[0]}}:{{code:'waiting'}};",
        limit = literal(HH_LIMIT_NOTICE),
    ))
}

/// The visibility editor of exactly this resume; `state()` is what hh.ru shows there.
fn visibility_guard(path: &str) -> String {
    format!(
        "{GUARD}if(location.pathname!=={path})return {{code:'editor_missing'}};\
var P={prefix};var types=Array.prototype.slice.call(document.querySelectorAll('[data-qa^=\"'+P+'\"]'));\
var boxOf=function(e){{return e.tagName==='INPUT'?e:(e.querySelector('input')||\
(e.closest('label')||document.createElement('i')).querySelector('input'));}};\
var mine=types.filter(function(e){{return e.getAttribute('data-qa')===P+{no_one};}});\
if(mine.length===0)return {{code:'waiting'}};if(mine.length>1)return {{code:'editor_ambiguous'}};\
var box=boxOf(mine[0]);if(!box)return {{code:'waiting'}};\
var setka=q({setka});var setkaBox=setka?(boxOf(setka)||setka):null;\
var setkaOn=!!setkaBox&&(setkaBox.checked===true||setkaBox.getAttribute('aria-checked')==='true');\
var others=types.some(function(e){{var b=boxOf(e);return e!==mine[0]&&!!b&&b.checked;}});",
        path = literal(path),
        prefix = literal(HH_ACCESS_PREFIX),
        no_one = literal(HH_ACCESS_NO_ONE),
        setka = literal(HH_SETKA_SWITCH),
    )
}

/// Polled on a freshly loaded editor: `hidden` only when «Не видно никому» is the one
/// chosen access type and Setka is off; otherwise `visible`.
pub fn visibility_script(path: &str) -> String {
    wrap(&format!(
        "{guard}if(!box.checked&&!others)return {{code:'waiting'}};\
return {{code:box.checked&&!others&&!setkaOn?'hidden':'visible'}};",
        guard = visibility_guard(path),
    ))
}

/// Polled: chooses «Не видно никому» and switches Setka off, each once.
pub fn hide_script(path: &str) -> String {
    wrap(&format!(
        "{guard}if(box.disabled)return {{code:'field_locked'}};\
if(!box.checked){{if(!st.noOne){{st.noOne=1;box.click();}}return {{code:'waiting'}};}}\
if(setkaOn){{if(!st.setka){{st.setka=1;setkaBox.click();}}return {{code:'waiting'}};}}\
return {{code:'chosen'}};",
        guard = visibility_guard(path),
    ))
}

/// Polled on the copy's own page: opens its delete question once, then confirms it once.
pub fn delete_script(copy_id: &str) -> String {
    wrap(&format!(
        "{GUARD}if(location.pathname.replace(/\\/$/,'')!=='/resume/'+{copy})\
return {{code:st.confirmed?'deleted':'editor_missing'}};\
var yes=all({confirm});if(yes.length>1)return {{code:'delete_unexpected'}};\
if(yes.length===1){{if(!st.asked)return {{code:'delete_unexpected'}};\
if(!st.confirmed){{st.confirmed=1;yes[0].click();}}return {{code:'waiting'}};}}\
if(!st.asked){{var b=all({delete});if(b.length===0)return {{code:'waiting'}};st.asked=1;b[0].click();}}\
return {{code:'waiting'}};",
        copy = literal(copy_id),
        confirm = literal(HH_DELETE_CONFIRM),
        delete = literal(HH_DELETE),
    ))
}

#[cfg(test)]
#[path = "hh_resume_copy_scripts_tests.rs"]
mod tests;
