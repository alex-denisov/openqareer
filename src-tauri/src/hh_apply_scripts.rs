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
//! - B708, re-checked 24.11.2026 (`MagrittePopup`, chunk 2534): on a phone-width
//!   window the response is a bottom sheet. Its resume card sits OUTSIDE
//!   `#RESPONSE_MODAL_FORM_ID`; a press on the card replaces the whole form with
//!   a list of `resumeId` radios (value = hash), and a choice brings the card back;
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
pub const HH_APPLY_CLOSE: &str = r#"[data-qa="response-popup-close"]"#;
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
/// «Видимость резюме»: hh.ru shows the resume in other countries only with consent.
pub const HH_VISIBILITY_WARNING: &str =
    r#"[data-qa="countries-profile-visibility-popup-confirm"]"#;
/// The error line of hh.ru's own response page.
pub const HH_PAGE_ERROR: &str = "[data-qa-popup-error-code]";
pub const HH_ARCHIVED: &str =
    r#"[data-qa="vacancy-title-archived-text"], [data-qa="vacancy-info-archived"]"#;
pub const HH_CAPTCHA: &str = r#"[data-qa="captcha"], #captcha, .captcha-container"#;
pub const HH_RESPONSE_PAGE: &str = "/applicant/vacancy_response";
/// Polls a pressed resume card gets to show a list.
const RESUME_LIST_POLLS: u8 = 4;
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

/// Polled on the vacancy page. `waiting`, `page_not_ready`, `not_signed_in` and
/// `no_response_button` are answers about this moment only: the caller keeps
/// asking until the page settles. The button is pressed at most once, and only
/// when React runs it: before that the press would follow its link to hh.ru's
/// own response page, which reads as a questionnaire.
pub fn open_script(vacancy_id: &str) -> String {
    wrap(&format!(
        "var closed=function(){{if(q({archived}))return true;var t=document.getElementById({state});if(!t)return false;\
try{{var s=JSON.parse((t.content&&t.content.textContent)||t.textContent||'').vacancyView.vacancyFull.vacancy.status;\
return s.archived===true||s.disabled===true;}}catch(e){{return false;}}}};\
var path=location.pathname.replace(/\\/$/,'');\
if(window.__oqOpened||path.indexOf({response_page})===0)return {{code:'opened'}};\
if(path.indexOf('/account/login')===0)return {{code:'not_signed_in'}};\
if(path!=={path})return {{code:'waiting'}};\
if(!signedIn())return {{code:'not_signed_in'}};\
if(q({already}))return {{code:'already_applied'}};\
var b=q({top})||q({bottom});if(!b)return {{code:closed()?'vacancy_closed':'no_response_button'}};\
var live=Object.keys(b).some(function(k){{return k.indexOf('__react')===0;}});\
if(!live)return {{code:'page_not_ready'}};\
window.__oqOpened=1;b.click();return {{code:'opened'}};",
        response_page = literal(HH_RESPONSE_PAGE),
        path = literal(&format!("/vacancy/{vacancy_id}")),
        already = literal(HH_ALREADY_APPLIED),
        archived = literal(HH_ARCHIVED),
        state = literal(HH_INITIAL_STATE_ID),
        top = literal(HH_RESPONSE_BUTTON_TOP),
        bottom = literal(HH_RESPONSE_BUTTON_BOTTOM),
    ))
}

/// hh.ru's own questions the candidate answered «yes» to on our screen.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Agreed {
    pub relocation: bool,
    pub visibility: bool,
}

/// What the page shows after a click. `open_code` is the answer for an open
/// response form: `popup` while waiting for it, `waiting` after the submit.
/// Only hh.ru's own elements count as a success, never page text (a vacancy
/// description can say «Отклик отправлен»), and only after our submit: before
/// it the same elements mean an earlier response.
fn surface_script(open_code: &str, success_code: &str, agreed: Agreed, tail: &str) -> String {
    wrap(&format!(
        "var ask=function(s,yes,code){{if(!seen(s))return null;if(!yes)return {{code:code}};\
var k='__oqAgreed_'+code;if(!window[k]){{window[k]=1;q(s).click();}}return {{code:'waiting'}};}};\
var asked=ask({relocation},{yes_relocation},'relocation_warning')||ask({visibility},{yes_visibility},'visibility_warning');\
if(asked)return asked;{tail}\
if(location.pathname.indexOf({response_page})===0||seen({questionnaire}))return {{code:'questionnaire'}};\
if(q({success}))return {{code:{done}}};\
if(seen({error}))return {{code:'hh_error'}};\
return {{code:seen({popup})?{open}:'waiting'}};",
        response_page = literal(HH_RESPONSE_PAGE),
        questionnaire = literal(HH_QUESTIONNAIRE),
        success = literal(HH_SUCCESS),
        error = literal(HH_RESPONSE_ERROR),
        relocation = literal(HH_RELOCATION_WARNING),
        visibility = literal(HH_VISIBILITY_WARNING),
        yes_relocation = agreed.relocation,
        yes_visibility = agreed.visibility,
        popup = literal(HH_APPLY_POPUP),
        open = literal(open_code),
        done = literal(success_code),
    ))
}

/// hh.ru either opens the response pop-up or, for a vacancy with a
/// questionnaire, takes the candidate to its own response page.
pub fn popup_script(agreed: Agreed) -> String {
    surface_script("popup", "already_applied", agreed, "")
}

/// Submit is pressed once per response: after it hh.ru may already have taken the response.
/// After the submit: an open pop-up still means "waiting", a success means `sent`.
pub fn result_script(agreed: Agreed) -> String {
    surface_script("waiting", "sent", agreed, "")
}

/// After the submit on hh.ru's own response page, where the form itself is the questionnaire.
pub fn page_result_script(agreed: Agreed) -> String {
    let tail = format!(
        "if(seen({error}))return {{code:'hh_error'}};\
if(location.pathname.indexOf({page})===0)return {{code:'waiting'}};",
        error = literal(HH_PAGE_ERROR),
        page = literal(HH_RESPONSE_PAGE),
    );
    surface_script("waiting", "sent", agreed, &tail)
}

/// B708: read-only look at the open page after an unsuccessful response: did the
/// candidate finish it by hand? Only on this vacancy's own page, only by hh.ru's
/// elements, and only once «Откликнуться» is gone: a toast next to a live button
/// belongs to a similar vacancy listed below. The captcha prelude reads page
/// text, so it is not used here.
pub fn window_script(vacancy_id: &str) -> String {
    format!(
        "(function(){{try{{var host=location.hostname,q=function(s){{return document.querySelector(s);}};\
var here=(host==='hh.ru'||host.slice(-6)==='.hh.ru')&&location.pathname.replace(/\\/$/,'')==={path};\
return {{code:here&&q({success})&&!q({top})&&!q({bottom})?'sent':'waiting'}};\
}}catch(e){{return {{code:'waiting'}};}}}})()",
        path = literal(&format!("/vacancy/{vacancy_id}")),
        success = literal(HH_SUCCESS),
        top = literal(HH_RESPONSE_BUTTON_TOP),
        bottom = literal(HH_RESPONSE_BUTTON_BOTTOM),
    )
}

/// Reads the resume the response form shows. `titles()` — the resume titles on
/// screen; `card()` — the chosen one: inside the form on a wide window, the only
/// title on screen in the bottom sheet. `hashNear` is React's resume next to a
/// title; React keeps a previous and a current tree, so a resume counts only
/// when its title is the one shown, and two different ids are no answer.
fn resume_prelude(resume_id: &str) -> String {
    format!(
        "var id={resume};var form=q({form})||(q({submit})&&q({submit}).closest('form'));\
var norm=function(s){{return String(s||'').replace(/\\s+/g,' ').trim();}};\
var txt=function(e){{return norm(e.textContent);}};\
var radios=[].slice.call(document.querySelectorAll({radio})).filter(function(e){{return e.type==='radio';}});\
var titles=function(){{return [].slice.call(document.querySelectorAll({title})).filter(function(e){{return e.getClientRects().length;}});}};\
var card=function(){{var own=form&&form.querySelector({title});if(own)return own;\
var all=titles();return all.length===1?all[0]:null;}};\
var fiber=function(el){{for(var k in el){{if(k.indexOf('__reactFiber$')===0)return el[k];}}return null;}};\
var resumeOf=function(f){{var p=(f&&f.memoizedProps)||{{}};\
return (p.slot&&p.slot.props&&p.slot.props.resume)||p.resume||p.selectedResume||null;}};\
var hashNear=function(el){{var f=fiber(el);for(var n=0;f&&n<25;n++,f=f.return){{\
var near=[resumeOf(f),resumeOf(f.alternate)].filter(function(r){{return r&&r.hash;}});if(!near.length)continue;\
var ids=near.filter(function(r){{var t=r.title&&r.title[0]&&r.title[0].string;return !t||norm(t)===txt(el);}})\
.map(function(r){{return r.hash;}});\
return ids.length&&ids.every(function(h){{return h===ids[0];}})?ids[0]:null;}}return null;}};",
        resume = literal(resume_id),
        form = literal(HH_APPLY_FORM),
        submit = literal(HH_SUBMIT),
        radio = literal(HH_RESUME_RADIO),
        title = literal(HH_RESUME_TITLE),
    )
}

/// Polled: answers `resume_ok` once the requested resume is the chosen one.
/// The list is opened and the matching option clicked at most once each. An id
/// decides whenever one can be read. Only when none can, `unique_title` — the
/// title of the requested resume, passed when no other resume of the candidate
/// has it — decides, and only if the form shows a single such title.
pub fn resume_script(resume_id: &str, unique_title: Option<&str>) -> String {
    wrap(&format!(
        "{prelude}var want=norm({want});\
var ok=function(text){{window.__oqResumeText=text;return {{code:'resume_ok'}};}};\
var pickOnce=function(el,text){{if(!window.__oqResumePicked){{window.__oqResumePicked=text||' ';el.click();}}return {{code:'waiting'}};}};\
if(radios.length){{var r=radios.filter(function(e){{return e.value===id;}})[0];\
if(!r||r.disabled)return {{code:'resume_not_found'}};\
if(form&&form.contains(r)&&r.checked)return ok('');\
var row=r;while(row&&!row.querySelector({title}))row=row.parentElement;\
var own=row?row.querySelectorAll({title}):[];\
return pickOnce(r,own.length===1?txt(own[0]):'');}}\
var trigger=card();if(!trigger)return {{code:'waiting'}};\
var current=hashNear(trigger);\
if(current===id)return ok(txt(trigger));\
if(!current&&window.__oqResumePicked===txt(trigger))return ok(txt(trigger));\
if(!window.__oqResumeDrop){{window.__oqResumeDrop=1;trigger.click();return {{code:'waiting'}};}}\
if(window.__oqResumePicked)return {{code:'waiting'}};\
var opts=titles().filter(function(e){{return e!==trigger;}});\
var box=function(t){{var b=t;while(b&&b!==document.body&&!b.querySelector('input'))b=b.parentElement;\
return (b&&b!==document.body&&b.querySelector('input'))||t;}};\
var byId=opts.filter(function(e){{return hashNear(e)===id;}});\
if(byId.length)return pickOnce(box(byId[0]),'');\
if(current)return {{code:'waiting'}};\
if(opts.length){{var same=opts.filter(function(e){{return want&&txt(e)===want;}});\
if(same.length!==1||opts.some(hashNear))return {{code:'resume_unknown'}};\
return pickOnce(box(same[0]),want);}}\
window.__oqResumePolls=(window.__oqResumePolls||0)+1;\
if(window.__oqResumePolls<{polls})return {{code:'waiting'}};\
return want&&txt(trigger)===want?ok(want):{{code:'resume_unknown'}};",
        prelude = resume_prelude(resume_id),
        want = literal(unique_title.unwrap_or_default()),
        title = literal(HH_RESUME_TITLE),
        polls = RESUME_LIST_POLLS,
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

/// Polled: presses «Откликнуться» only while the field still holds the letter
/// and the form still shows the resume `resume_script` confirmed. The button is
/// pressed at most once: a dropped answer is asked again, not pressed again.
pub fn submit_script(resume_id: &str, letter: &str) -> String {
    wrap(&format!(
        "if(window.__oqSubmitted)return {{code:'submitted'}};\
var area=q({area});if(!area)return {{code:'letter_field_missing'}};\
if(area.value!=={letter})return {{code:'letter_not_kept'}};\
{prelude}if(typeof window.__oqResumeText!=='string')return {{code:'resume_unknown'}};\
if(radios.length){{if(!radios.some(function(e){{return e.checked&&e.value===id&&form&&form.contains(e);}}))return {{code:'resume_unknown'}};}}\
else{{var shown=card();if(!shown)return {{code:'waiting'}};var now=hashNear(shown);\
if(now?now!==id:txt(shown)!==window.__oqResumeText)return {{code:'resume_unknown'}};}}\
var s=q({submit});if(!s)return {{code:'submit_unavailable'}};\
if(s.disabled||s.getAttribute('aria-disabled')==='true')return {{code:'waiting'}};\
window.__oqSubmitted=1;s.click();return {{code:'submitted'}};",
        prelude = resume_prelude(resume_id),
        area = literal(HH_LETTER_TEXTAREA),
        letter = literal(&normalized_letter(letter)),
        submit = literal(HH_SUBMIT),
    ))
}

/// What the page held when a step failed: presence flags and counts only, in one
/// token of the local diagnostics log. No text, ids or addresses.
/// `p` page (v this vacancy, o other), `s` signed in, `b` response button,
/// `m` close button, `f` form, `l` letter toggle, `a` letter field, `x` submit,
/// `t` resume titles, `r` resume radios, `h` a readable id, `n` narrow window.
pub fn diagnostic_script(vacancy_id: &str) -> String {
    let flags = [
        (
            "b",
            format!("{HH_RESPONSE_BUTTON_TOP}, {HH_RESPONSE_BUTTON_BOTTOM}"),
        ),
        ("m", HH_APPLY_CLOSE.to_string()),
        ("f", HH_APPLY_FORM.to_string()),
        ("l", HH_LETTER_TOGGLE.to_string()),
        ("a", HH_LETTER_TEXTAREA.to_string()),
        ("x", HH_SUBMIT.to_string()),
    ]
    .iter()
    .map(|(name, selector)| format!("+'-{name}'+(q({})?1:0)", literal(selector)))
    .collect::<String>();
    wrap(&format!(
        "{prelude}var all=titles();var cap=function(n){{return Math.min(n,99);}};\
return {{code:'p'+(location.pathname.replace(/\\/$/,'')==={path}?'v':'o')+'-s'+(signedIn()?1:0){flags}\
+'-t'+cap(all.length)+'-r'+cap(radios.length)+'-h'+(all.some(hashNear)?1:0)+'-n'+(window.innerWidth<600?1:0)}};",
        prelude = resume_prelude(""),
        path = literal(&format!("/vacancy/{vacancy_id}")),
    ))
}

#[cfg(test)]
#[path = "hh_apply_scripts_tests.rs"]
mod tests;
