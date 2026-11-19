//! B708/B709: the fixed page scripts of the hh.ru response flow (B704).
//!
//! Selectors were re-taken on 19.11.2026 from hh.ru's own shipped bundles
//! (`i.hh.ru/build/*.js`, components `VacancyResponseForm`, `ResumeSelectorV2`,
//! `VacancyResponseLink`, `SupernovaMainMenu`) after the live response failed:
//! - the response modal has no `data-qa` of its own; its form is
//!   `#RESPONSE_MODAL_FORM_ID` and its close button `response-popup-close`;
//! - «Добавить сопроводительное» is `add-cover-letter`, and it reveals the
//!   letter field 200 ms later, so the letter is a polled step;
//! - a candidate with several resumes gets a drop-down whose markup carries
//!   no resume id: the resume shown is read from the React props next to its
//!   title (`resume.hash`, the id the hh API returns);
//! - between 600 and 1020 px hh hides the profile menu (`visibleOn [M, L]`)
//!   and the mobile menu button reads `mainmenu_anonMobileMenu-button` for
//!   every visitor, so the width-independent sign-in signal is `userType` in
//!   the page's initial state.
//!
//! Each script is one expression answering `{code}`; parameters enter only as
//! JSON string literals.

use crate::connector_session::HH_SIGNED_IN_SELECTOR;

pub const HH_RESPONSE_BUTTON_TOP: &str = r#"[data-qa="vacancy-response-link-top"]"#;
pub const HH_RESPONSE_BUTTON_BOTTOM: &str = r#"[data-qa="vacancy-response-link-bottom"]"#;
/// hh.ru renders «Вы откликнулись» with this button once a response exists.
pub const HH_ALREADY_APPLIED: &str = r#"[data-qa="vacancy-response-link-view-topic"]"#;
pub const HH_APPLY_POPUP: &str = r#"#RESPONSE_MODAL_FORM_ID, [data-qa="response-popup-close"]"#;
pub const HH_APPLY_FORM: &str = "#RESPONSE_MODAL_FORM_ID";
/// The plain resume list (radio inputs named `resumeId`, value = resume hash).
pub const HH_RESUME_RADIO: &str = r#"input[name="resumeId"]"#;
pub const HH_RESUME_TITLE: &str = r#"[data-qa="resume-title"]"#;
pub const HH_LETTER_TOGGLE: &str =
    r#"[data-qa="add-cover-letter"], [data-qa="vacancy-response-letter-toggle"]"#;
pub const HH_LETTER_TEXTAREA: &str = r#"textarea[data-qa="vacancy-response-popup-form-letter-input"], [data-qa="vacancy-response-popup-form-letter-input"] textarea"#;
pub const HH_SUBMIT: &str = r#"[data-qa="vacancy-response-submit-popup"]"#;
pub const HH_QUESTIONNAIRE: &str = r#"[data-qa="vacancy-response-questionnaire"]"#;
/// The «Отклик отправлен» toast, or the «Вы откликнулись» button that replaces
/// «Откликнуться» once hh.ru accepted the response.
pub const HH_SUCCESS: &str = r#"[data-qa="vacancy-response-success-standard-notification"], [data-qa="vacancy-response-link-view-topic"]"#;
pub const HH_RESPONSE_ERROR: &str = r#"[data-qa="vacancy-response-error-notification"]"#;
/// «Вы откликаетесь на вакансию в другой стране»: the candidate decides, not us.
pub const HH_RELOCATION_WARNING: &str = r#"[data-qa="relocation-warning-confirm"]"#;
pub const HH_CAPTCHA: &str = r#"[data-qa="captcha"], #captcha, .captcha-container"#;
pub const HH_INITIAL_STATE_ID: &str = "HH-Lux-InitialState";

pub(crate) fn literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// The letter exactly as a textarea will hold it.
pub fn normalized_letter(letter: &str) -> String {
    letter.trim().replace("\r\n", "\n")
}

/// Shared prelude: element helpers, the sign-in check and the blocking surfaces.
fn prelude() -> String {
    format!(
        "var q=function(s){{return document.querySelector(s);}};\
var seen=function(s){{var e=q(s);return !!(e&&e.getClientRects().length);}};\
var signedIn=function(){{if(q({signed}))return true;var t=document.getElementById({state});\
if(!t)return false;var raw=(t.content&&t.content.textContent)||t.textContent||'';\
try{{return JSON.parse(raw).userType==='applicant';}}catch(e){{return false;}}}};\
var bodyText=((document.body&&document.body.innerText)||'').slice(0,2000);\
if(seen({captcha})||/(captcha|robot|робот|проверка)/i.test(document.title)||\
/(подтвердите[^.]{{0,80}}(?:робот|человек)|captcha)/i.test(bodyText))return {{code:'captcha'}};",
        signed = literal(HH_SIGNED_IN_SELECTOR),
        state = literal(HH_INITIAL_STATE_ID),
        captcha = literal(HH_CAPTCHA),
    )
}

pub(crate) fn wrap(body: &str) -> String {
    format!(
        "(function(){{try{{{prelude}{body}}}catch(e){{return {{code:'script_error'}};}}}})()",
        prelude = prelude(),
    )
}

pub fn open_script() -> String {
    wrap(&format!(
        "if(!signedIn())return {{code:'not_signed_in'}};\
if(q({already}))return {{code:'already_applied'}};\
var b=q({top})||q({bottom});if(!b)return {{code:'no_response_button'}};\
b.click();return {{code:'opened'}};",
        already = literal(HH_ALREADY_APPLIED),
        top = literal(HH_RESPONSE_BUTTON_TOP),
        bottom = literal(HH_RESPONSE_BUTTON_BOTTOM),
    ))
}

/// What the page shows after a click. `open_code` is the answer for an open
/// response form: `popup` while waiting for it, `waiting` after the submit.
/// Only hh.ru's own elements count as a success, never page text (a vacancy
/// description can say «Отклик отправлен»), and only after our submit: before
/// it the same elements mean an earlier response.
fn surface_script(open_code: &str, success_code: &str) -> String {
    wrap(&format!(
        "if(location.pathname.indexOf('/applicant/vacancy_response')===0||seen({questionnaire}))return {{code:'questionnaire'}};\
if(q({success}))return {{code:{done}}};\
if(seen({error}))return {{code:'hh_error'}};\
if(seen({relocation}))return {{code:'relocation_warning'}};\
return {{code:seen({popup})?{open}:'waiting'}};",
        questionnaire = literal(HH_QUESTIONNAIRE),
        success = literal(HH_SUCCESS),
        error = literal(HH_RESPONSE_ERROR),
        relocation = literal(HH_RELOCATION_WARNING),
        popup = literal(HH_APPLY_POPUP),
        open = literal(open_code),
        done = literal(success_code),
    ))
}

/// hh.ru either opens the response pop-up or, for a vacancy with a
/// questionnaire, takes the candidate to its own response page.
pub fn popup_script() -> String {
    surface_script("popup", "already_applied")
}

/// After the submit: an open pop-up still means "waiting", a success means `sent`.
pub fn result_script() -> String {
    surface_script("waiting", "sent")
}

/// Polled: answers `resume_ok` once the requested resume is the chosen one.
/// The drop-down is opened and the matching option clicked at most once each.
pub fn resume_script(resume_id: &str) -> String {
    wrap(&format!(
        "var id={resume};var form=q({form})||document;\
var radios=form.querySelectorAll({radio});\
if(radios.length){{for(var i=0;i<radios.length;i++){{var r=radios[i];\
if(r.value===id){{if(!r.checked)r.click();return {{code:'resume_ok'}};}}}}return {{code:'resume_not_found'}};}}\
var fiber=function(el){{for(var k in el){{if(k.indexOf('__reactFiber$')===0)return el[k];}}return null;}};\
var hashNear=function(el){{var f=fiber(el);for(var n=0;f&&n<25;n++,f=f.return){{var p=f.memoizedProps||{{}};\
if(p.slot&&p.slot.props&&p.slot.props.resume&&p.slot.props.resume.hash)return p.slot.props.resume.hash;\
if(p.resume&&p.resume.hash)return p.resume.hash;\
if(p.selectedResume&&p.selectedResume.hash)return p.selectedResume.hash;}}return null;}};\
var trigger=form.querySelector({title});if(!trigger)return {{code:'waiting'}};\
var current=hashNear(trigger);if(!current)return {{code:'resume_unknown'}};\
if(current===id)return {{code:'resume_ok'}};\
var titles=document.querySelectorAll({title});\
for(var j=0;j<titles.length;j++){{var t=titles[j];if(t===trigger||hashNear(t)!==id)continue;\
if(!window.__oqResumePicked){{window.__oqResumePicked=1;var box=t;\
while(box&&box!==document.body&&!box.querySelector('input'))box=box.parentElement;\
var input=box&&box!==document.body?box.querySelector('input'):null;(input||t).click();}}\
return {{code:'waiting'}};}}\
if(!window.__oqResumeDrop){{window.__oqResumeDrop=1;trigger.click();}}\
return {{code:'waiting'}};",
        resume = literal(resume_id),
        form = literal(HH_APPLY_FORM),
        radio = literal(HH_RESUME_RADIO),
        title = literal(HH_RESUME_TITLE),
    ))
}

/// Polled: reveals the letter field once, then types the letter into it.
pub fn letter_script(letter: &str) -> String {
    wrap(&format!(
        "var area=q({area});\
if(!area){{var t=q({toggle});if(t&&!window.__oqLetterOpened){{window.__oqLetterOpened=1;t.click();}}return {{code:'waiting'}};}}\
var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;\
setter.call(area,{letter});area.dispatchEvent(new Event('input',{{bubbles:true}}));\
area.dispatchEvent(new Event('change',{{bubbles:true}}));return {{code:'letter_set'}};",
        area = literal(HH_LETTER_TEXTAREA),
        toggle = literal(HH_LETTER_TOGGLE),
        letter = literal(&normalized_letter(letter)),
    ))
}

/// Polled: presses «Откликнуться» only while the field still holds the letter.
pub fn submit_script(letter: &str) -> String {
    wrap(&format!(
        "var area=q({area});if(!area)return {{code:'letter_field_missing'}};\
if(area.value!=={letter})return {{code:'letter_not_kept'}};\
var s=q({submit});if(!s)return {{code:'submit_unavailable'}};\
if(s.disabled||s.getAttribute('aria-disabled')==='true')return {{code:'waiting'}};\
s.click();return {{code:'submitted'}};",
        area = literal(HH_LETTER_TEXTAREA),
        letter = literal(&normalized_letter(letter)),
        submit = literal(HH_SUBMIT),
    ))
}

#[cfg(test)]
#[path = "hh_apply_scripts_tests.rs"]
mod tests;
