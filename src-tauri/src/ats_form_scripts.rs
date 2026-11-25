//! B787: the one fixed page script of the form engine. An operation name and a
//! JSON argument are the only things substituted into it; candidate data
//! travels as JSON, never as code.

use serde_json::Value;

const PAGE_SCRIPT: &str = include_str!("ats_form.js");
const OP_PLACEHOLDER: &str = "__OQ_ATS_OP__";
const ARG_PLACEHOLDER: &str = "__OQ_ATS_ARG__";

pub const OPERATIONS: &[&str] = &[
    "read", "snapshot", "fill", "job", "options", "next", "moved", "submit", "outcome",
];

/// `</script>` and line separators cannot end the literal early.
fn json_literal(value: &Value) -> String {
    value
        .to_string()
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

pub fn script(operation: &str, argument: &Value) -> Result<String, String> {
    if !OPERATIONS.contains(&operation) {
        return Err("ats_operation_unknown".to_string());
    }
    Ok(PAGE_SCRIPT
        .replacen(OP_PLACEHOLDER, &json_literal(&Value::from(operation)), 1)
        .replacen(ARG_PLACEHOLDER, &json_literal(argument), 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hh_jsdom_harness::run;
    use serde_json::json;

    /// Reduced from a public Greenhouse board page (25.11.2026): same ids,
    /// roles and nesting, no employer text.
    const BOARD: &str = r#"
<form method="get" action="/acme/jobs/1" id="application-form">
  <label id="first_name-label" for="first_name">First Name<span aria-hidden="true">*</span></label>
  <input id="first_name" aria-label="First Name" aria-required="true" type="text" value="">
  <label for="email">Email<span aria-hidden="true">*</span></label>
  <input id="email" aria-label="Email" aria-required="true" type="text" value="">
  <div class="select"><label id="country-label" for="country">Country</label>
    <div class="select-shell"><div class="select__control">
      <input class="select__input" id="country" type="text" role="combobox" aria-labelledby="country-label" aria-required="false" value="">
    </div></div>
    <input required="" tabindex="-1" aria-hidden="true" value="">
  </div>
  <div role="group" aria-labelledby="upload-label-resume" aria-required="true" class="file-upload">
    <div id="upload-label-resume">Resume/CV<span class="required">*</span></div>
    <button type="button">Attach</button><label class="visually-hidden" for="resume">Attach</label>
    <input id="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf">
  </div>
  <label for="question_1">Why us?</label><textarea id="question_1" aria-required="false"></textarea>
  <select id="question_2" required><option value="">Select</option><option value="1">Yes</option><option value="0">No</option></select>
  <fieldset><legend>Notice period</legend>
    <label><input type="radio" name="notice" value="now"> Now</label>
    <label><input type="radio" name="notice" value="month"> A month</label>
  </fieldset>
  <label for="gdpr_processing"><input id="gdpr_processing" type="checkbox" required> I agree to the <a href="https://acme.example/privacy">Privacy Policy</a></label>
  <input type="hidden" name="fingerprint" value="x">
  <button type="submit" aria-disabled="false">Submit application</button>
</form>"#;

    fn op(name: &str, argument: Value) -> String {
        script(name, &argument).unwrap()
    }

    fn press(name: &str) -> String {
        op(name, json!({ "hosts": ["hh.ru"], "path": "/acme" }))
    }

    fn parsed(value: &Value, index: usize) -> Value {
        serde_json::from_str(value["results"][index].as_str().unwrap()).unwrap()
    }

    #[test]
    fn only_known_operations_build_and_data_cannot_close_the_script() {
        assert_eq!(
            script("eval", &json!(null)).unwrap_err(),
            "ats_operation_unknown"
        );
        let built = script(
            "fill",
            &json!({ "entries": [{ "key": "id:a", "value": "</script>" }] }),
        )
        .unwrap();
        assert!(!built.contains("</script>"));
        assert!(!built.contains(OP_PLACEHOLDER) && !built.contains(ARG_PLACEHOLDER));
    }

    #[test]
    fn reads_label_kind_required_and_options_of_every_field() {
        let Some(out) = run(BOARD, "/acme/jobs/1", "", &[op("read", json!(null))]) else {
            return;
        };
        let form = parsed(&out, 0);
        assert_eq!(form["state"], "ready");
        assert_eq!(form["submitButtons"], 1);
        assert_eq!(form["submitLabel"], "Submit application");
        assert_eq!(form["captcha"], false);
        let fields = form["fields"].as_array().unwrap();
        let brief: Vec<(&str, &str, &str, bool)> = fields
            .iter()
            .map(|field| {
                (
                    field["key"].as_str().unwrap(),
                    field["label"].as_str().unwrap(),
                    field["kind"].as_str().unwrap(),
                    field["required"].as_bool().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            brief,
            [
                ("id:first_name", "First Name", "text", true),
                ("id:email", "Email", "text", true),
                ("id:country", "Country", "combobox", false),
                ("id:resume", "Resume/CV", "file", true),
                ("id:question_1", "Why us?", "textarea", false),
                ("id:question_2", "", "select", true),
                ("name:notice", "Notice period", "radio", false),
                (
                    "id:gdpr_processing",
                    "I agree to the Privacy Policy",
                    "checkbox",
                    true
                ),
            ]
        );
        assert_eq!(
            fields[5]["options"][1],
            json!({ "value": "1", "label": "Yes" })
        );
        assert_eq!(
            fields[6]["options"][1],
            json!({ "value": "month", "label": "A month" })
        );
        assert_eq!(fields[7]["link"], "https://acme.example/privacy");
    }

    #[test]
    fn fills_then_reads_the_same_values_back() {
        let entries = json!({ "entries": [
            { "key": "id:first_name", "value": "Test" },
            { "key": "id:question_1", "value": "Because" },
            { "key": "id:question_2", "value": "Yes" },
            { "key": "name:notice", "value": "A month" },
            { "key": "id:gdpr_processing", "value": "true" },
            { "key": "id:absent", "value": "x" },
            { "key": "id:resume", "value": "" },
        ] });
        let scripts = [
            op("fill", entries),
            op("job", json!(null)),
            op("job", json!(null)),
            op("snapshot", json!(null)),
        ];
        let Some(out) = run(BOARD, "/acme/jobs/1", "", &scripts) else {
            return;
        };
        let job = parsed(&out, 2);
        assert_eq!(job["done"], true);
        assert_eq!(job["results"]["id:first_name"], "set");
        assert_eq!(job["results"]["id:absent"], "field_missing");
        assert_eq!(job["results"]["id:resume"], "file_missing");
        let values = parsed(&out, 3)["values"].clone();
        assert_eq!(values["id:first_name"], "Test");
        assert_eq!(values["id:question_1"], "Because");
        assert_eq!(values["id:question_2"], "1");
        assert_eq!(values["name:notice"], "month");
        assert_eq!(values["id:gdpr_processing"], "true");
        assert_eq!(values["id:email"], "");
        assert_eq!(values["id:resume"], "");
    }

    #[test]
    fn presses_the_only_submit_button_once() {
        let scripts = [press("submit"), press("submit")];
        let setup = "document.getElementById('application-form').addEventListener('submit', e => e.preventDefault());";
        let Some(out) = run(BOARD, "/acme/jobs/1", setup, &scripts) else {
            return;
        };
        assert_eq!(parsed(&out, 0)["state"], "clicked");
        assert_eq!(parsed(&out, 1)["state"], "already_submitted");
        let presses = out["clicks"].as_array().unwrap().len();
        assert_eq!(presses, 1);
    }

    #[test]
    fn refuses_to_submit_when_the_button_is_not_exactly_one_or_is_disabled() {
        let two = BOARD.replace(
            "</form>",
            r#"<button type="submit">Save draft</button></form>"#,
        );
        let off = BOARD.replace(r#"aria-disabled="false""#, r#"aria-disabled="true""#);
        for (html, state) in [(two, "submit_ambiguous"), (off, "submit_disabled")] {
            let Some(out) = run(&html, "/acme/jobs/1", "", &[press("submit")]) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], state);
            assert_eq!(out["clicks"].as_array().unwrap().len(), 0);
        }
    }

    #[test]
    fn the_outcome_is_confirmed_only_by_the_board_itself() {
        let argument = json!({ "confirmationPath": "/acme/jobs/1/confirmation" });
        let cases = [
            (
                "<h1>Thank you for applying.</h1>",
                "/acme/jobs/1/confirmation",
                "confirmed",
            ),
            (
                "<h1>Thank you for applying.</h1>",
                "/acme/jobs/1",
                "pending",
            ),
            (
                "<h1>Thank you for applying.</h1>",
                "/x/acme/jobs/1/confirmation",
                "pending",
            ),
            ("<h1>Something</h1>", "/acme/jobs/1", "pending"),
            (BOARD, "/acme/jobs/1", "pending"),
        ];
        for (html, path, state) in cases {
            let Some(out) = run(html, path, "", &[op("outcome", argument.clone())]) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], state, "{path}");
        }
        let invalid = BOARD.replace(r#"id="email" "#, r#"id="email" aria-invalid="true" "#);
        let Some(out) = run(&invalid, "/acme/jobs/1", "", &[op("outcome", argument)]) else {
            return;
        };
        assert_eq!(
            parsed(&out, 0),
            json!({ "state": "invalid", "keys": ["id:email"] })
        );
    }

    #[test]
    fn a_mark_older_than_the_press_is_not_a_refusal() {
        let stale = BOARD.replace(r#"id="email" "#, r#"id="email" aria-invalid="true" "#);
        let outcome = || op("outcome", json!({ "invalidBefore": ["id:email"] }));
        let quiet = "document.getElementById('application-form').addEventListener('submit', e => e.preventDefault());";
        let refuse = "document.querySelector('button[type=submit]').addEventListener('click', e => { e.preventDefault(); document.getElementById('first_name').setAttribute('aria-invalid', 'true'); });";
        for (setup, expected) in [
            (quiet, json!({ "state": "pending" })),
            (
                refuse,
                json!({ "state": "invalid", "keys": ["id:first_name"] }),
            ),
        ] {
            let scripts = [press("submit"), outcome()];
            let Some(out) = run(&stale, "/acme/jobs/1", setup, &scripts) else {
                return;
            };
            assert_eq!(
                parsed(&out, 0),
                json!({ "state": "clicked", "invalidBefore": ["id:email"], "countedBefore": false })
            );
            assert_eq!(parsed(&out, 1), expected);
        }
    }

    #[test]
    fn a_sign_in_page_or_a_missing_form_is_named_not_guessed() {
        let sign_in = r#"<form><input name="user"><input type="password" name="p"><button type="submit">Sign in</button></form>"#;
        for (html, state) in [
            (sign_in, "account_required"),
            ("<p>Closed</p>", "form_missing"),
        ] {
            let Some(out) = run(html, "/acme/jobs/1", "", &[op("read", json!(null))]) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], state);
        }
    }

    const ASHBY: &str = include_str!("ats_fixtures/ashby.html");
    const LEVER: &str = include_str!("ats_fixtures/lever.html");
    const RECRUITEE: &str = include_str!("ats_fixtures/recruitee.html");
    const WORKABLE: &str = include_str!("ats_fixtures/workable.html");
    const PINPOINT: &str = include_str!("ats_fixtures/pinpoint.html");
    const TEAMTAILOR: &str = include_str!("ats_fixtures/teamtailor.html");
    const BREEZY: &str = include_str!("ats_fixtures/breezy.html");
    const BAMBOOHR: &str = include_str!("ats_fixtures/bamboohr.html");
    const SMART: &str = include_str!("ats_fixtures/smartrecruiters.html");
    /// jsdom leaves declarative shadow trees closed.
    const SHADOW: &str = "document.querySelectorAll('template[shadowrootmode]').forEach((t) => { const root = t.parentElement.attachShadow({ mode: 'open' }); root.append(t.content); t.remove(); });";

    fn brief(form: &Value) -> Vec<(String, String, String, bool)> {
        let text = |value: &Value| value.as_str().unwrap().to_string();
        form["fields"]
            .as_array()
            .unwrap()
            .iter()
            .map(|field| {
                (
                    text(&field["key"]),
                    text(&field["label"]),
                    text(&field["kind"]),
                    field["required"] == true,
                )
            })
            .collect()
    }

    fn expected(rows: &[(&str, &str, &str, bool)]) -> Vec<(String, String, String, bool)> {
        rows.iter()
            .map(|(key, label, kind, required)| {
                (
                    key.to_string(),
                    label.to_string(),
                    kind.to_string(),
                    *required,
                )
            })
            .collect()
    }

    #[test]
    fn breezy_is_read_without_its_trap_and_left_for_the_candidate_to_send() {
        let at = json!({ "hosts": ["hh.ru"], "path": "/p/1/apply" });
        let scripts = [op("read", json!(null)), op("submit", at)];
        let Some(out) = run(BREEZY, "/p/1/apply", "", &scripts) else {
            return;
        };
        let form = parsed(&out, 0);
        assert_eq!(
            brief(&form),
            expected(&[
                ("name:cResume", "Resume", "file", true),
                ("name:cName", "Full Name", "text", true),
                ("name:cEmail", "Email Address", "email", true),
                ("name:cPhoneNumber", "Phone Number", "text", false),
                ("name:cCoverLetter", "Cover Letter", "textarea", false),
                (
                    "name:section_1_question_0",
                    "Which tools do you use?",
                    "text",
                    true
                ),
                (
                    "name:section_1_question_1",
                    "How did you hear about us?",
                    "radio",
                    false
                ),
            ])
        );
        assert_eq!(form["step"], "submit");
        assert_eq!(form["submitLabel"], "Submit Application");
        assert_eq!(parsed(&out, 1)["state"], "captcha");
        assert_eq!(out["clicks"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn bamboohr_is_read_without_its_trap_and_left_for_the_candidate_to_send() {
        let at = json!({ "hosts": ["hh.ru"], "path": "/careers/1" });
        let scripts = [op("read", json!(null)), op("submit", at)];
        let Some(out) = run(BAMBOOHR, "/careers/1", "", &scripts) else {
            return;
        };
        let form = parsed(&out, 0);
        assert_eq!(
            brief(&form),
            expected(&[
                ("name:firstName", "First Name", "text", true),
                ("name:email", "Email", "text", true),
                ("name:city.value", "City", "text", true),
                ("name:state.value", "State", "combobox", true),
                ("name:resumeFileId", "Resume", "file", true),
                ("name:linkedinUrl", "LinkedIn URL", "text", false),
                (
                    "name:customQuestionAnswers.long_1",
                    "Why us?",
                    "textarea",
                    true
                ),
            ])
        );
        assert_eq!(form["submitButtons"], 1);
        assert_eq!(parsed(&out, 1)["state"], "captcha");
        assert_eq!(out["clicks"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn bamboohr_s_form_is_opened_once_and_only_on_a_vacancy_page() {
        let page = r#"<div data-fabric-component="Box"><button type="button" id="open">Apply for This Job</button><button type="button" id="again">Apply for This Job</button></div>"#;
        let read = || op("read", json!({ "hosts": ["hh.ru"], "path": "/careers/1" }));
        for (path, presses) in [
            ("/careers/1", 1),
            ("/careers/2", 0),
            ("/careers", 0),
            ("/x/careers/1", 0),
        ] {
            let Some(out) = run(page, path, "", &[read(), read()]) else {
                return;
            };
            assert_eq!(parsed(&out, 1)["state"], "form_missing");
            assert_eq!(out["clicks"].as_array().unwrap().len(), presses, "{path}");
        }
    }

    #[test]
    fn bamboohr_s_date_keeps_its_key_and_the_way_the_field_spells_it() {
        let page = r#"<form id="job-application-form"><div data-fabric-component="TextInputWrapper"><label for="FabricTextField-77">Date Available</label><input type="text" id="FabricTextField-77" placeholder="mm/dd/yyyy"></div><button type="submit">Submit Application</button></form>"#;
        let key = "label:Date Available";
        let Some(out) = run(
            page,
            "/careers/1",
            "",
            &[
                op("read", Value::Null),
                op(
                    "fill",
                    json!({ "entries": [{ "key": key, "value": "2027-01-15" }] }),
                ),
                op("job", Value::Null),
                op("snapshot", Value::Null),
            ],
        ) else {
            return;
        };
        assert_eq!(parsed(&out, 0)["fields"][0]["key"], key);
        assert_eq!(parsed(&out, 3)["values"][key], "01/15/2027");
    }

    #[test]
    fn bamboohr_confirms_only_by_its_own_words_in_place_of_the_form() {
        let said =
            "<div><h2>Thank You</h2><p>Your application was submitted successfully</p></div>";
        let other = "<div><h2>Thank You</h2><p>Your application was saved</p></div>";
        let with_form = format!("{BAMBOOHR}{said}");
        let cases = [
            (said, "/careers/1", "confirmed"),
            (said, "/careers/2", "pending"),
            (other, "/careers/1", "pending"),
            (with_form.as_str(), "/careers/1", "pending"),
        ];
        for (html, path, state) in cases {
            let script = op(
                "outcome",
                json!({ "thanks": "bamboohr", "thanksPaths": ["/careers/1"] }),
            );
            let Some(out) = run(html, path, "", &[script]) else {
                return;
            };
            assert_ne!(
                parsed(&out, 0)["state"] == "confirmed",
                state != "confirmed",
                "{path}"
            );
        }
    }

    #[test]
    fn a_board_that_thanks_in_place_is_known_by_its_own_sign_in_any_language() {
        let ashby = r#"<div class="ashby-application-form-success-container">Gracias</div>"#;
        let blocked = r#"<div class="ashby-application-form-failure-container">No</div>"#;
        let workable = r#"<div data-ui="successful-submit"><h3>Danke</h3></div>"#;
        let frame = r#"<turbo-frame id="application_form"><h2>Gracias</h2></turbo-frame>"#;
        let sent = "window.gtmFormSubmissionData = { id: 1 };";
        let cases = [
            ("ashby", "/a", ashby, "", "confirmed"),
            ("ashby", "/b", ashby, "", "pending"),
            ("ashby", "/a", blocked, "", "pending"),
            ("workable", "/a", workable, "", "confirmed"),
            ("workable", "/a", "<h3>Danke</h3>", "", "pending"),
            ("teamtailor", "/applications", frame, "", "pending"),
            ("teamtailor", "/applications", "<h1>500</h1>", "", "pending"),
            ("teamtailor", "/a", frame, "", "pending"),
            ("pinpoint", "/a", "<h1>Merci</h1>", sent, "confirmed"),
            ("pinpoint", "/a", "<h1>Merci</h1>", "", "pending"),
            ("lever", "/a", workable, sent, "pending"),
        ];
        for (board, path, html, setup, state) in cases {
            let argument = json!({ "thanks": board, "thanksPaths": ["/a", "/applications"], "countedBefore": false });
            let Some(out) = run(html, path, setup, &[op("outcome", argument)]) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], state, "{board} {path}");
        }
        for counted in [json!(true), json!(null)] {
            let argument =
                json!({ "thanks": "pinpoint", "thanksPaths": ["/a"], "countedBefore": counted });
            let Some(out) = run("<h1>Merci</h1>", "/a", sent, &[op("outcome", argument)]) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], "pending");
        }
    }

    #[test]
    fn teamtailor_confirms_by_the_servers_answer_to_the_press() {
        let html = format!(
            r#"<h1>Tech</h1><turbo-frame id="application_form">{TEAMTAILOR}</turbo-frame>"#
        );
        let answer = |success: bool, left: &str| {
            format!(
                "document.addEventListener('submit', (e) => {{ e.preventDefault(); const form = e.target; form.dispatchEvent(new CustomEvent('turbo:submit-end', {{ bubbles: true, detail: {{ success: {success}, formSubmission: {{ formElement: form }} }} }})); document.querySelector('turbo-frame').innerHTML = '{left}'; }}); document.querySelectorAll('[required]').forEach((n) => n.removeAttribute('required'));"
            )
        };
        let thanks = "<h2>Gracias por la solicitud</h2>";
        for (setup, state) in [
            (answer(true, thanks), "confirmed"),
            (answer(false, thanks), "pending"),
            (answer(true, "<h1>Tech</h1>"), "pending"),
            (
                answer(
                    true,
                    r#"<form id="job-application-form"></form><h2>No</h2>"#,
                ),
                "pending",
            ),
        ] {
            let argument = json!({ "thanks": "teamtailor", "thanksPaths": ["/acme"] });
            let scripts = [press("submit"), op("outcome", argument)];
            let Some(out) = run(&html, "/acme", &setup, &scripts) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], "clicked");
            assert_eq!(parsed(&out, 1)["state"], state, "{setup}");
        }
    }

    #[test]
    fn smartrecruiters_is_read_and_filled_inside_its_shadow_trees() {
        let entries =
            json!({ "entries": [{ "key": "id:confirm-email-input", "value": "a@b.example" }] });
        let scripts = [
            op("read", json!(null)),
            op("fill", entries),
            op("snapshot", json!(null)),
            op(
                "submit",
                json!({ "hosts": ["hh.ru"], "path": "/oneclick-ui" }),
            ),
        ];
        let Some(out) = run(SMART, "/oneclick-ui", SHADOW, &scripts) else {
            return;
        };
        let form = parsed(&out, 0);
        let mut fields = brief(&form);
        fields.sort();
        assert_eq!(
            fields,
            expected(&[
                ("id:confirm-email-input", "Confirm your email", "text", true),
                ("id:email-input", "Email", "text", true),
                ("id:file-1", "Resume", "file", false),
                ("id:first-name-input", "First name", "text", true),
                ("id:linkedin-input", "LinkedIn", "text", false),
            ])
        );
        assert_eq!(form["step"], "next");
        assert_eq!(
            parsed(&out, 2)["values"]["id:confirm-email-input"],
            "a@b.example"
        );
        assert_eq!(parsed(&out, 3)["state"], "submit_ambiguous");
    }

    /// Menus answer at once in jsdom; the page script waits between looks.
    const NO_WAIT: &str = "window.setTimeout = (f) => { queueMicrotask(f); };";

    #[test]
    fn teamtailor_waits_for_its_file_fields_and_for_the_upload() {
        let box_up = "const b = document.querySelector('#upload_resume_field'); b.dataset.controller = 'forms--inputs--upload'; const f = b.querySelector('input[type=file]');";
        let late = format!("{box_up} f.remove();");
        let read = [op("read", json!(null))];
        let Some(out) = run(TEAMTAILOR, "/jobs/1/applications/new", &late, &read) else {
            return;
        };
        assert_eq!(parsed(&out, 0)["state"], "loading");
        let key = "id:candidate_resume_remote_url";
        let file = json!({ "name": "cv.pdf", "type": "application/pdf", "base64": "JVBERg==" });
        let entries = json!({ "entries": [{ "key": key, "value": "", "file": file }] });
        let transfer = "window.DataTransfer = class { constructor() { this.files = []; this.items = { add: (x) => this.files.push(x) }; } };";
        let swap = format!("{NO_WAIT} {transfer} {box_up} Object.defineProperty(f, 'files', {{ writable: true }}); f.addEventListener('change', () => {{ f.disabled = true; const u = document.createElement('input'); u.id = f.id; u.value = 'https://s3.example/tmp/cv.pdf'; u.setAttribute('data-forms--inputs--upload-preview-target', 'urlInput'); b.append(u); }});");
        let scripts = [
            op("fill", entries),
            op("job", json!(null)),
            op("snapshot", json!(null)),
        ];
        let out = run(TEAMTAILOR, "/jobs/1/applications/new", &swap, &scripts).unwrap();
        assert_eq!(parsed(&out, 1)["results"][key], "set");
        assert_eq!(parsed(&out, 2)["values"][key], "cv.pdf");
    }

    #[test]
    fn the_button_of_a_taken_file_or_of_another_form_is_not_the_send_button() {
        let preview = r#"<div class="dz-preview dz-success"><button tabindex="0" title="Borrar" data-dz-remove>Borrar</button></div>"#;
        let other = r#"<form><button type="submit">Subscribe</button></form></body>"#;
        let blank = r#"<button><svg></svg></button>"#;
        let taken = TEAMTAILOR
            .replacen("</form>", &format!("{preview}{blank}</form>"), 1)
            .replace("</body>", other);
        let apply = r#"<button type="submit">Apply</button></form>"#;
        let second = taken.replacen("</form>", apply, 1);
        for (html, state, presses) in [(taken, "clicked", 1), (second, "submit_ambiguous", 0)] {
            let scripts = [press("submit")];
            let setup = "document.addEventListener('submit', e => e.preventDefault(), true);";
            let Some(out) = run(&html, "/acme/jobs/1", setup, &scripts) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], state);
            assert_eq!(out["clicks"].as_array().unwrap().len(), presses);
        }
    }

    #[test]
    fn every_board_s_public_form_is_read_with_labels_kinds_and_one_send_button() {
        // (form, fields, required, send button)
        for (html, fields, required, send) in [
            (ASHBY, 13, 10, "Submit Application"),
            (LEVER, 21, 8, "Submit application"),
            (RECRUITEE, 9, 7, "Send"),
            (TEAMTAILOR, 9, 6, "Enviar solicitud"),
            (WORKABLE, 13, 8, "Submit application"),
            (PINPOINT, 11, 8, "Submit Application"),
        ] {
            let Some(out) = run(html, "/acme/jobs/1", "", &[op("read", json!(null))]) else {
                return;
            };
            let form = parsed(&out, 0);
            let list = form["fields"].as_array().unwrap();
            assert_eq!(
                (
                    form["state"].as_str(),
                    form["unkeyed"].as_u64(),
                    form["submitButtons"].as_u64()
                ),
                (Some("ready"), Some(0), Some(1)),
                "{send}"
            );
            assert_eq!(form["submitLabel"], send);
            assert_eq!(form["step"], "submit");
            assert_eq!(list.len(), fields, "{send}");
            let marked = list
                .iter()
                .filter(|field| field["required"] == true)
                .count();
            assert_eq!(marked, required, "{send}");
            for field in list {
                assert_ne!(field["label"], "", "{send} {}", field["key"]);
                let choice = ["radio", "checkbox_group", "select"]
                    .contains(&field["kind"].as_str().unwrap());
                assert_eq!(
                    choice,
                    !field["options"].as_array().unwrap().is_empty(),
                    "{send}"
                );
            }
        }
    }

    #[test]
    fn a_question_of_several_checkboxes_and_a_yes_no_question_take_named_options() {
        let setup = "document.querySelectorAll('button[data-option]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); b.setAttribute('aria-pressed', 'true'); }));";
        let read = [op("read", json!(null))];
        let Some(first) = run(ASHBY, "/a", "", &read) else {
            return;
        };
        let form = parsed(&first, 0);
        let key = |kind: &str| {
            form["fields"]
                .as_array()
                .unwrap()
                .iter()
                .find(|field| field["kind"] == kind)
                .unwrap()["key"]
                .clone()
        };
        let (group, yes_no) = (key("checkbox_group"), key("radio"));
        let entries = json!({ "entries": [
            { "key": group, "value": "Series A or B startup\nSeries E+ startup" },
            { "key": yes_no, "value": "No" },
        ] });
        let scripts = [
            op("fill", entries),
            op("job", json!(null)),
            op("snapshot", json!(null)),
        ];
        let out = run(ASHBY, "/a", setup, &scripts).unwrap();
        let values = parsed(&out, 2)["values"].clone();
        assert_eq!(
            values[group.as_str().unwrap()],
            "Series A or B startup\nSeries E+ startup"
        );
        assert_eq!(values[yes_no.as_str().unwrap()], "No");
        let wrong = json!({ "entries": [{ "key": group, "value": "Seed" }] });
        let out = run(
            ASHBY,
            "/a",
            "",
            &[op("fill", wrong), op("job", json!(null))],
        )
        .unwrap();
        assert_eq!(
            parsed(&out, 1)["results"][group.as_str().unwrap()],
            "option_missing"
        );
    }

    const COMBO: &str = r#"
<form><label for="city">City*</label>
  <input id="city" role="combobox" aria-controls="menu" type="text">
  <ul id="menu" role="listbox"></ul>
  <input type="file" id="cv" aria-label="CV">
  <button type="submit">Apply</button></form>"#;
    const COMBO_SETUP: &str = "window.setTimeout = (f) => { queueMicrotask(f); };
      const city = document.getElementById('city'), menu = document.getElementById('menu');
      const show = (q) => { menu.innerHTML = ''; ['Warsaw, Poland','Warsaw, Indiana','Wien'].filter(x => x.toLowerCase().includes(q)).forEach(x => { const li = document.createElement('li'); li.setAttribute('role','option'); li.textContent = x; li.addEventListener('mousedown', () => { city.value = x; }); menu.append(li); }); };
      city.addEventListener('input', () => show(city.value.toLowerCase()));
      city.addEventListener('mousedown', () => show(''));
      city.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.innerHTML = ''; });";

    #[test]
    fn a_closed_list_is_read_searched_and_set_only_to_an_exact_option() {
        let request = |query: &str| {
            op(
                "options",
                json!({ "requests": [{ "key": "id:city", "query": query }] }),
            )
        };
        let fill = |value: &str| {
            op(
                "fill",
                json!({ "entries": [{ "key": "id:city", "value": value }] }),
            )
        };
        let job = || op("job", json!(null));
        let scripts = [
            request(""),
            job(),
            request("wars"),
            job(),
            fill("Warsaw"),
            job(),
            fill("warsaw, poland"),
            job(),
            op("snapshot", json!(null)),
        ];
        let Some(out) = run(COMBO, "/a", COMBO_SETUP, &scripts) else {
            return;
        };
        let found = |index: usize| parsed(&out, index)["results"]["id:city"].clone();
        assert_eq!(found(1).as_array().unwrap().len(), 3);
        assert_eq!(found(3).as_array().unwrap().len(), 2);
        assert_eq!(found(5), "option_missing");
        assert_eq!(found(7), "set");
        assert_eq!(parsed(&out, 8)["values"]["id:city"], "Warsaw, Poland");
    }

    const STEPS: &str = r#"
<form><div id="one"><label for="name">Name*</label><input id="name" required></div>
  <div id="two" hidden><label for="why">Why?</label><textarea id="why"></textarea>
    <button type="submit" id="send">Submit application</button></div>
  <button type="button" id="next">Next</button><button type="button">Back</button></form>"#;
    const STEPS_SETUP: &str = "const el = (id) => document.getElementById(id);
      document.forms[0].addEventListener('submit', (e) => e.preventDefault());
      el('next').addEventListener('click', () => {
        if (!el('name').value) { el('name').setAttribute('aria-invalid', 'true'); return; }
        el('name').removeAttribute('aria-invalid');
        el('one').hidden = true; el('next').hidden = true; el('two').hidden = false; });";

    #[test]
    fn steps_are_walked_one_page_at_a_time_and_only_the_last_one_sends() {
        let name = json!({ "entries": [{ "key": "id:name", "value": "Test" }] });
        let moved = || op("moved", json!({ "signature": "/acme|id:name" }));
        let scripts = [
            op("read", json!(null)),
            press("submit"),
            press("next"),
            moved(),
            op("fill", name),
            press("next"),
            moved(),
            press("next"),
            press("submit"),
            press("submit"),
        ];
        let Some(out) = run(STEPS, "/acme", &format!("{NO_WAIT}{STEPS_SETUP}"), &scripts) else {
            return;
        };
        let state = |index: usize| parsed(&out, index)["state"].clone();
        assert_eq!(parsed(&out, 0)["step"], "next");
        assert_eq!(parsed(&out, 0)["signature"], "/acme|id:name");
        assert_eq!(state(1), "submit_ambiguous");
        assert_eq!(state(2), "clicked");
        assert_eq!(
            parsed(&out, 3),
            json!({ "state": "invalid", "keys": ["id:name"] })
        );
        assert_eq!(state(5), "clicked");
        assert_eq!(state(6), "moved");
        assert_eq!(parsed(&out, 6)["form"]["step"], "submit");
        assert_eq!(parsed(&out, 6)["form"]["fields"][0]["key"], "id:why");
        assert_eq!(state(7), "next_ambiguous");
        assert_eq!(state(8), "clicked");
        assert_eq!(state(9), "already_submitted");
    }

    #[test]
    fn nothing_is_pressed_once_the_page_has_left_its_address() {
        let at = |path: &str, host: &str| json!({ "hosts": [host], "path": path });
        for (argument, state) in [
            (json!(null), "off_target"),
            (at("/acme/jobs/1", "other.example"), "off_target"),
            (at("/acme/jobs/2", "hh.ru"), "off_target"),
            (at("/acme/jobs", "hh.ru"), "clicked"),
            (at("/acme/jobs/1", "hh.ru"), "clicked"),
        ] {
            let Some(out) = run(BOARD, "/acme/jobs/1", "", &[op("submit", argument)]) else {
                return;
            };
            assert_eq!(parsed(&out, 0)["state"], state);
            assert_eq!(
                out["clicks"].as_array().unwrap().len(),
                usize::from(state == "clicked")
            );
        }
        // The application path moved between the last look and the press.
        let moved = "history.pushState(null, '', '/acme/jobs/12');";
        let script = [op("submit", at("/acme/jobs/1", "hh.ru"))];
        let out = run(BOARD, "/acme/jobs/1", moved, &script).unwrap();
        assert_eq!(parsed(&out, 0)["state"], "off_target");
    }
}
