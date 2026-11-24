//! B787: the one fixed page script of the form engine. An operation name and a
//! JSON argument are the only things substituted into it; candidate data
//! travels as JSON, never as code.

use serde_json::Value;

const PAGE_SCRIPT: &str = include_str!("ats_form.js");
const OP_PLACEHOLDER: &str = "__OQ_ATS_OP__";
const ARG_PLACEHOLDER: &str = "__OQ_ATS_ARG__";

pub const OPERATIONS: &[&str] = &["read", "snapshot", "fill", "job", "submit", "outcome"];

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
        let scripts = [op("submit", json!(null)), op("submit", json!(null))];
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
            let Some(out) = run(&html, "/acme/jobs/1", "", &[op("submit", json!(null))]) else {
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
                "confirmed",
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
}
