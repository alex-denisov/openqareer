//! B678 slice 3: the fixed page scripts that edit one hh.ru resume section.
//!
//! Selectors were taken on 19.11.2026 from hh.ru's shipped bundles
//! (`i.hh.ru/build/ResumeEditBlock{Position,KeySkills,About}-route.*.js`,
//! layout `ResumePartialEditLayout`, magritte `Suggest`/`Chip`):
//! - each section has its own editor page `/resume/edit/<hash>/<block>`;
//! - the save button is `resume-partial-edit-save`; a successful save leaves
//!   the editor page (to the resume or, after a skills change, to
//!   `skillsLevels`), field errors mark the field `aria-invalid`;
//! - title and «О себе» are a plain input / textarea set through React's
//!   native value setter;
//! - a key skill is added through the skills suggest: the typed text appears
//!   as `suggest-item-user-input` (or a dictionary item `suggest-item-chips`),
//!   a recommended skill is a checkbox `resume-editor-skills-recommended-<name>`.
//!
//! Work experience is not edited here: the editor changes a place of work for
//! every resume that shows it, and hh.ru's rule is a new place ticked only for
//! this resume, which the editor bundles do not expose.
//!
//! Scripts only add or replace text. They never press delete, never touch the
//! other fields of the page and never press a button other than «Сохранить».

use crate::hh_apply_scripts::{literal, wrap};

pub const HH_EDIT_SAVE: &str = r#"[data-qa="resume-partial-edit-save"]"#;
pub const HH_EDIT_TITLE: &str = r#"input[data-qa="resume-edit-title-suggest"]"#;
pub const HH_EDIT_ABOUT: &str = r#"textarea[data-qa="resume-editor-about"]"#;
pub const HH_EDIT_SKILLS_INPUT: &str = r#"[data-qa="resume-editor-skills-input"]"#;
pub const HH_SKILL_SUGGESTION: &str =
    r#"[data-qa="suggest-item-user-input"], [data-qa="suggest-item-chips"]"#;
pub const HH_SKILL_RECOMMENDED_PREFIX: &str = "resume-editor-skills-recommended-";
pub const HH_SKILL_CHIP_DELETE: &str = r#"[data-qa="chip-delete-action"]"#;
pub const HH_FIELD_INVALID: &str = r#"[aria-invalid="true"]"#;

/// The editor block of hh.ru's resume editor for a section we edit.
pub fn block_of(section: &str) -> Option<&'static str> {
    match section {
        "title" => Some("position"),
        "skills" => Some("keySkills"),
        "about" => Some("about"),
        _ => None,
    }
}

pub fn edit_path(resume_id: &str, block: &str) -> String {
    format!("/resume/edit/{resume_id}/{block}")
}

/// Helpers shared by the skills scripts: the text of a skill as hh.ru shows it,
/// and the skills already chosen (the chips that carry a delete action).
fn skills_helpers() -> String {
    format!(
        "var norm=function(s){{return String(s||'').replace(/\\s+/g,' ').trim().toLowerCase();}};\
var chosen=function(){{var out=[];var del=document.querySelectorAll({delete});\
for(var i=0;i<del.length;i++){{var c=del[i].parentElement;for(var n=0;c&&n<3;n++,c=c.parentElement){{\
var t=norm(String(c.textContent).replace(del[i].textContent,''));if(t){{out.push(t);break;}}}}}}return out;}};",
        delete = literal(HH_SKILL_CHIP_DELETE),
    )
}

fn signed_in_on(path: &str) -> String {
    format!(
        "if(!signedIn())return {{code:'not_signed_in'}};\
if(location.pathname!=={path})return {{code:'editor_missing'}};",
        path = literal(path),
    )
}

/// Polled: puts `value` into the title input or the «О себе» textarea.
pub fn field_script(path: &str, selector: &str, value: &str) -> String {
    wrap(&format!(
        "{guard}var el=q({field});if(!el)return {{code:'waiting'}};\
if(el.disabled||el.readOnly)return {{code:'field_locked'}};\
var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;\
Object.getOwnPropertyDescriptor(proto,'value').set.call(el,{value});\
el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));\
return {{code:el.value==={value}?'field_set':'field_not_kept'}};",
        guard = signed_in_on(path),
        field = literal(selector),
        value = literal(value),
    ))
}

/// Polled: adds one key skill. A recommended checkbox is ticked; otherwise the
/// skill is typed once into the suggest and its own suggestion clicked once.
pub fn skill_script(path: &str, skill: &str) -> String {
    wrap(&format!(
        "{guard}{helpers}var want=norm({skill});\
if(chosen().indexOf(want)>=0)return {{code:'skill_present'}};\
var st=window.__oqSkill;if(!st||st.name!==want){{st=window.__oqSkill={{name:want}};}}\
var rec=document.querySelectorAll('[data-qa^='+JSON.stringify({prefix})+']');\
for(var i=0;i<rec.length;i++){{var r=rec[i];\
if(norm(r.getAttribute('data-qa').slice({prefix_len}))!==want)continue;\
var box=r.tagName==='INPUT'?r:r.querySelector('input');\
if(box&&box.checked)return {{code:'skill_present'}};\
if(!st.ticked){{st.ticked=1;(box||r).click();}}return {{code:'waiting'}};}}\
var host=q({input});if(!host)return {{code:'waiting'}};\
var input=host.tagName==='INPUT'?host:host.querySelector('input');if(!input)return {{code:'waiting'}};\
if(!st.typed){{st.typed=1;input.focus();\
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,{skill});\
input.dispatchEvent(new Event('input',{{bubbles:true}}));return {{code:'waiting'}};}}\
if(!st.picked){{var items=document.querySelectorAll({suggestion});\
for(var j=0;j<items.length;j++){{if(norm(items[j].textContent)===want){{st.picked=1;items[j].click();break;}}}}}}\
return {{code:'waiting'}};",
        guard = signed_in_on(path),
        helpers = skills_helpers(),
        skill = literal(skill),
        prefix = literal(HH_SKILL_RECOMMENDED_PREFIX),
        prefix_len = HH_SKILL_RECOMMENDED_PREFIX.len(),
        input = literal(HH_EDIT_SKILLS_INPUT),
        suggestion = literal(HH_SKILL_SUGGESTION),
    ))
}

/// Polled: presses «Сохранить» once, when it is enabled and no field is invalid.
pub fn save_script(path: &str) -> String {
    wrap(&format!(
        "{guard}if(q({invalid}))return {{code:'field_invalid'}};\
var b=q({save});if(!b)return {{code:'waiting'}};\
if(b.disabled||b.getAttribute('aria-disabled')==='true')return {{code:'waiting'}};\
if(!window.__oqSaved){{window.__oqSaved=1;b.click();}}return {{code:'save_clicked'}};",
        guard = signed_in_on(path),
        invalid = literal(HH_FIELD_INVALID),
        save = literal(HH_EDIT_SAVE),
    ))
}

/// Polled after the click: hh.ru leaves the editor page once the save went through.
pub fn saved_script(path: &str) -> String {
    wrap(&format!(
        "if(location.pathname!=={path})return {{code:'saved'}};\
if(q({invalid}))return {{code:'field_invalid'}};return {{code:'waiting'}};",
        path = literal(path),
        invalid = literal(HH_FIELD_INVALID),
    ))
}

/// Reads the field back from a freshly opened editor page.
pub fn read_field_script(path: &str, selector: &str) -> String {
    wrap(&format!(
        "{guard}var el=q({field});if(!el)return {{code:'waiting'}};return {{code:'read',value:el.value}};",
        guard = signed_in_on(path),
        field = literal(selector),
    ))
}

/// Reads the chosen key skills back from a freshly opened editor page.
pub fn read_skills_script(path: &str) -> String {
    wrap(&format!(
        "{guard}{helpers}if(!q({input}))return {{code:'waiting'}};return {{code:'read',values:chosen()}};",
        guard = signed_in_on(path),
        helpers = skills_helpers(),
        input = literal(HH_EDIT_SKILLS_INPUT),
    ))
}

#[cfg(test)]
#[path = "hh_resume_edit_scripts_tests.rs"]
mod tests;
