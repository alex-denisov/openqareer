//! B678 slice 4: the fixed page scripts that put a reworded place of work into
//! one hh.ru resume.
//!
//! A place of work on hh.ru belongs to the profile and is ticked per resume, so
//! editing it in place would change every resume that shows it. hh.ru's rule
//! is a new place ticked only for this resume, with the original unticked
//! here and left untouched. The scripts do exactly that.
//!
//! Selectors come from hh.ru's `resume-profile-front` bundles on 19.11.2026
//! (chunks 1058, 2715, 2137, 8868); they were not checked on a live page (the
//! orchestrator chose a hard stop instead):
//! - the list with this resume's ticks: `resume-profile-experience-checkable-item`
//!   (`-checkbox`, `-edit`), card texts `company-name-title`, `position-title`,
//!   `position-description`; «+ Добавить» is `list-add`;
//! - the place form: `resume-profile-experience-specific-<field>-input-<i>`,
//!   «по настоящее время» `...-now-checkbox-<i>`, save / cancel
//!   `modal-edit-list-item-save` / `modal-edit-list-item-cancel`;
//! - «Резюме с этим местом работы»: heading `profile-education-resume-label`,
//!   one checkbox per resume with `name="<resume hash>"`;
//! - the page save: `profile-layout-save-button`.
//!
//! Every script stops (a code other than `waiting`) when the page is not what
//! it expects. Nothing is saved unless the new place is ticked for exactly this
//! resume. The scripts never press delete and never tick or untick another
//! resume; the only box they untick is this resume's tick of the original.

use crate::hh_apply_scripts::{literal, wrap};
use serde::{Deserialize, Serialize};

pub const HH_EXP_CARD: &str = "resume-profile-experience-checkable-item";
pub const HH_EXP_FIELD: &str = "resume-profile-experience-specific-";
pub const HH_EXP_ADD: &str = r#"[data-qa="list-add"]"#;
pub const HH_EXP_ADD_NEW_TEXT: &str = "добавить новый";
pub const HH_EXP_ITEM_SAVE: &str = r#"[data-qa="modal-edit-list-item-save"]"#;
pub const HH_EXP_ITEM_CANCEL: &str = r#"[data-qa="modal-edit-list-item-cancel"]"#;
pub const HH_EXP_RESUMES_LABEL: &str = r#"[data-qa="profile-education-resume-label"]"#;
pub const HH_EXP_PAGE_SAVE: &str = r#"[data-qa="profile-layout-save-button"]"#;
/// How much of a description identifies a place (cards may shorten it).
const DESCRIPTION_KEY_CHARS: usize = 40;

/// The place of work as the resume shows it: how the original card is found.
#[derive(Debug, Clone, Serialize)]
pub struct PlaceKey {
    pub employer: String,
    pub position: String,
    pub was: String,
}

/// The original place's form, copied into the new place.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceFields {
    pub company: String,
    pub position: String,
    pub start_month: String,
    pub start_year: String,
    #[serde(default)]
    pub end_month: String,
    #[serde(default)]
    pub end_year: String,
    #[serde(default)]
    pub now: bool,
}

fn object(value: &impl Serialize) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

/// Shared helpers: normalised text, the cards, the open form and its fields.
fn helpers() -> String {
    format!(
        "if(window.__oqStale)return {{code:'waiting'}};if(!signedIn())return {{code:'not_signed_in'}};\
var norm=function(s){{return String(s||'').replace(/\\s+/g,' ').trim().toLowerCase();}};\
var st=window.__oqExp=window.__oqExp||{{}};\
var inCard=function(c,qa){{var e=c.querySelector('[data-qa=\"'+qa+'\"]');return e?norm(e.textContent):'';}};\
var box=function(el){{if(!el)return null;return el.tagName==='INPUT'?el:el.querySelector('input');}};\
var cardBox=function(c){{return box(c.querySelector('[data-qa=\"'+{card}+'-checkbox\"]'));}};\
var cards=function(){{return Array.prototype.slice.call(document.querySelectorAll('[data-qa=\"'+{card}+'\"]'));}};\
var F={field};\
var form=function(){{var e=q('[data-qa^=\"'+F+'company-input-\"]');if(!e)return null;\
return e.getAttribute('data-qa').slice((F+'company-input-').length);}};\
var fld=function(name,i){{var e=q('[data-qa=\"'+F+name+'-'+i+'\"]');if(!e)return null;\
return (e.tagName==='INPUT'||e.tagName==='TEXTAREA')?e:(e.querySelector('input,textarea')||e);}};\
var wrapText=function(name,i){{var e=q('[data-qa=\"'+F+name+'-'+i+'\"]');return e?String(e.textContent).trim():'';}};\
var locked=function(b){{return !!(b&&(b.disabled||b.getAttribute('aria-disabled')==='true'));}};\
var KEY={key};",
        card = literal(HH_EXP_CARD),
        field = literal(HH_EXP_FIELD),
        key = DESCRIPTION_KEY_CHARS,
    )
}

/// The resume ticks of the open place form: every checked box in the form
/// (the whole modal, not one block of it) except «по настоящее время» must be
/// this resume. Answers `null` when only this resume is ticked.
fn ticks_check(resume_id: &str) -> String {
    format!(
        "var H={hash};var tickCode=function(){{var c=fld('company-input',form());if(!c||!q({label}))return 'waiting';\
var area=c;while(area&&!area.querySelector({save}))area=area.parentElement;if(!area)return 'waiting';\
var ticks=area.querySelectorAll('input[type=\"checkbox\"]'),mine=false;\
for(var t=0;t<ticks.length;t++){{var qa=ticks[t].getAttribute('data-qa')||'';\
if(!ticks[t].checked||qa.indexOf('now-checkbox')>=0)continue;if(ticks[t].name===H)mine=true;\
else return 'other_resumes_ticked';}}return mine?null:'resume_not_ticked';}};",
        hash = literal(resume_id),
        label = literal(HH_EXP_RESUMES_LABEL),
        save = literal(HH_EXP_ITEM_SAVE),
    )
}

/// The cards that are this place: same employer and position, and — when the
/// resume had text — a description that starts like it.
fn matcher(place: &PlaceKey) -> String {
    format!(
        "var P={place};var emp=norm(P.employer),pos=norm(P.position),was=norm(P.was).slice(0,KEY);\
var same=function(c,text){{var e=inCard(c,'company-name-title'),p=inCard(c,'position-title');\
if(!e||!(e.indexOf(emp)>=0||emp.indexOf(e)>=0))return false;if(p!==pos)return false;\
if(!text)return true;var d=inCard(c,'position-description');\
return !!d&&(d.indexOf(text)>=0||text.indexOf(d.slice(0,KEY))>=0);}};\
var matches=function(text){{return cards().filter(function(c){{return same(c,text);}});}};",
        place = object(place),
    )
}

/// Polled: finds the original place in this resume's list.
pub fn locate_script(place: &PlaceKey) -> String {
    wrap(&format!(
        "{helpers}{matcher}if(cards().length===0)return {{code:'waiting'}};\
var m=matches(was);if(m.length===0)return {{code:'place_not_found'}};\
if(m.length>1)return {{code:'place_ambiguous'}};var b=cardBox(m[0]);\
if(!b)return {{code:'place_not_found'}};\
return {{code:'located',checked:!!b.checked,locked:locked(b)}};",
        helpers = helpers(),
        matcher = matcher(place),
    ))
}

/// Polled: opens the original's form once and reads what it holds.
pub fn read_original_script(place: &PlaceKey) -> String {
    wrap(&format!(
        "{helpers}{matcher}var i=form();\
if(i===null){{if(st.opened)return {{code:'waiting'}};var m=matches(was);\
if(m.length!==1)return {{code:'place_not_found'}};\
var pen=m[0].querySelector('[data-qa=\"'+{card}+'-edit\"]');if(!pen)return {{code:'place_not_found'}};\
st.opened=1;pen.click();return {{code:'waiting'}};}}\
var c=fld('company-input',i);if(!c||!c.value)return {{code:'waiting'}};\
var now=fld('now-checkbox',i);\
return {{code:'read',fields:{{company:c.value,position:(fld('position-input',i)||{{}}).value||'',\
startMonth:wrapText('datestart-month-input',i),startYear:(fld('datestart-year-input',i)||{{}}).value||'',\
endMonth:wrapText('dateend-month-input',i),endYear:(fld('dateend-year-input',i)||{{}}).value||'',\
now:!!(now&&now.checked)}}}};",
        helpers = helpers(),
        matcher = matcher(place),
        card = literal(HH_EXP_CARD),
    ))
}

/// Polled: closes the original's form with «Отмена», changing nothing.
pub fn cancel_script() -> String {
    wrap(&format!(
        "{helpers}if(form()===null)return {{code:'closed'}};\
if(!st.cancelled){{var b=q({cancel});if(!b)return {{code:'cancel_missing'}};st.cancelled=1;b.click();}}\
return {{code:'waiting'}};",
        helpers = helpers(),
        cancel = literal(HH_EXP_ITEM_CANCEL),
    ))
}

/// Polled: «+ Добавить», then «Добавить новый» if hh.ru asks which place to add;
/// done when an empty place form is open.
pub fn add_script() -> String {
    wrap(&format!(
        "{helpers}var i=form();\
if(i!==null){{if(!st.added)return {{code:'form_unexpected'}};var c=fld('company-input',i);\
return {{code:c&&!c.value?'form_open':'form_not_empty'}};}}\
if(!st.added){{var a=q({add});if(!a)return {{code:'waiting'}};if(locked(a))return {{code:'add_locked'}};\
st.added=1;a.click();return {{code:'waiting'}};}}\
if(!st.addNew){{var bs=document.querySelectorAll('button,[role=\"button\"]');\
for(var k=0;k<bs.length;k++){{if(norm(bs[k].textContent)==={add_new}&&bs[k].getClientRects().length){{\
st.addNew=1;bs[k].click();break;}}}}}}return {{code:'waiting'}};",
        helpers = helpers(),
        add = literal(HH_EXP_ADD),
        add_new = literal(HH_EXP_ADD_NEW_TEXT),
    ))
}

/// Polled: fills the new place and checks it is ticked for this resume only.
/// Never touches a resume tick: another resume ticked is a stop.
pub fn fill_script(fields: &PlaceFields, text: &str, resume_id: &str) -> String {
    wrap(&format!(
        "{helpers}{ticks}var V={fields},T={text};var i=form();if(i===null||!st.added)return {{code:'form_missing'}};\
var setv=function(name,v){{var e=fld(name,i);if(!e)return false;if(e.value===v)return true;\
st.typed=st.typed||{{}};if((st.typed[name]=(st.typed[name]||0)+1)>3)return false;\
var proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;\
Object.getOwnPropertyDescriptor(proto,'value').set.call(e,v);\
e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));\
return e.value===v;}};\
var month=function(name,v){{if(!v)return true;if(norm(wrapText(name,i))===norm(v))return true;\
st.month=st.month||{{}};var s=st.month[name]=st.month[name]||{{}};\
if(!s.open){{var w=q('[data-qa=\"'+F+name+'-'+i+'\"]');if(!w)return false;s.open=1;\
(w.querySelector('button,[role=\"combobox\"]')||w).click();return false;}}\
if(!s.picked){{var os=document.querySelectorAll('[role=\"option\"]');\
for(var k=0;k<os.length;k++){{if(norm(os[k].textContent)===norm(v)){{s.picked=1;os[k].click();break;}}}}}}\
return false;}};\
var ok=setv('company-input',V.company)&&setv('position-input',V.position)&&setv('datestart-year-input',V.startYear)\
&&month('datestart-month-input',V.startMonth);\
var now=fld('now-checkbox',i);\
if(V.now){{if(!now)return {{code:'waiting'}};if(!now.checked&&!st.now){{st.now=1;now.click();}}ok=ok&&now.checked;}}\
else{{if(now&&now.checked)return {{code:'now_mismatch'}};ok=ok&&setv('dateend-year-input',V.endYear)&&month('dateend-month-input',V.endMonth);}}\
ok=setv('responsibilities-input',T)&&ok;\
var tc=tickCode();if(tc==='waiting'){{st.ticksOk=0;return {{code:'waiting'}};}}if(tc)return {{code:tc}};\
st.ticksOk=(st.ticksOk||0)+1;\
if(!ok||st.ticksOk<2||q('[aria-invalid=\"true\"]'))return {{code:'waiting'}};return {{code:'filled'}};",
        helpers = helpers(),
        ticks = ticks_check(resume_id),
        fields = object(fields),
        text = literal(text),
    ))
}

/// Polled: saves the new place once, checking the resume ticks again right
/// before the click; done when its form closes.
pub fn item_save_script(resume_id: &str) -> String {
    wrap(&format!(
        "{helpers}{ticks}if(form()===null)return {{code:st.itemSaved?'item_saved':'form_missing'}};\
if(!st.added)return {{code:'form_missing'}};if(q('[aria-invalid=\"true\"]'))return {{code:'field_invalid'}};\
if(!st.itemSaved){{var tc=tickCode();if(tc)return {{code:tc}};var b=q({save});if(!b)return {{code:'waiting'}};if(locked(b))return {{code:'waiting'}};\
st.itemSaved=1;b.click();}}return {{code:'waiting'}};",
        helpers = helpers(),
        ticks = ticks_check(resume_id),
        save = literal(HH_EXP_ITEM_SAVE),
    ))
}

/// Polled: unticks the original place for this resume — its own text stays as it was.
pub fn untick_script(place: &PlaceKey) -> String {
    wrap(&format!(
        "{helpers}{matcher}var m=matches(was);if(m.length!==1)return {{code:'place_not_found'}};\
var b=cardBox(m[0]);if(!b)return {{code:'place_not_found'}};if(!b.checked)return {{code:'unticked'}};\
if(locked(b))return {{code:'original_locked'}};if(!st.unticked){{st.unticked=1;b.click();}}\
return {{code:'waiting'}};",
        helpers = helpers(),
        matcher = matcher(place),
    ))
}

/// Polled: presses the page's save once; done when hh.ru leaves the page or
/// takes the button away. No page save at all is reported, not guessed.
pub fn page_save_script() -> String {
    wrap(&format!(
        "{helpers}var b=q({save});\
if(st.pageSaved){{if(location.pathname!==st.pageSaved||!b)return {{code:'saved'}};return {{code:'waiting'}};}}\
if(!b){{st.noSave=(st.noSave||0)+1;return {{code:st.noSave>6?'no_page_save':'waiting'}};}}\
if(q('[aria-invalid=\"true\"]'))return {{code:'field_invalid'}};if(locked(b))return {{code:'waiting'}};\
st.pageSaved=location.pathname;b.click();return {{code:'waiting'}};",
        helpers = helpers(),
        save = literal(HH_EXP_PAGE_SAVE),
    ))
}

/// Marks the page and reloads it. Every script waits while the mark is there,
/// so a run never starts on, or reads back, a DOM an earlier step changed.
pub fn reload_script() -> String {
    wrap("window.__oqStale=1;location.reload();return {code:'reloading'};")
}

/// Reads the list back on a reloaded page: the new place ticked, the original not.
pub fn read_back_script(place: &PlaceKey, text: &str) -> String {
    wrap(&format!(
        "{helpers}{matcher}if(cards().length===0)return {{code:'waiting'}};\
var ticked=function(list){{return list.some(function(c){{var b=cardBox(c);return !!(b&&b.checked);}});}};\
return {{code:'read',added:ticked(matches(norm({text}).slice(0,KEY))),\
originalTicked:was?ticked(matches(was)):true}};",
        helpers = helpers(),
        matcher = matcher(place),
        text = literal(text),
    ))
}

#[cfg(test)]
#[path = "hh_resume_experience_scripts_tests.rs"]
mod tests;
