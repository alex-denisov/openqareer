//! B641: reads the employer's questions from the response form hh.ru opened
//! after the candidate pressed «Отправить». One fixed script compiled into the
//! app, no parameters: it never clicks, types, navigates or submits. A form it
//! does not fully understand yields no questions, only the form's address.

use crate::connector_session::{eval_json, is_transient_eval_error};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const PAGE_SCRIPT: &str = include_str!("hh_questionnaire_page.js");
const FILL_SCRIPT: &str = include_str!("hh_questionnaire_fill.js");
const ACT_MARK: &str = "/* OQ_ACT */";
const ANSWERS_MARK: &str = "\"__OQ_ANSWERS__\"";
const READ_WAIT: Duration = Duration::from_secs(10);
const READ_POLL: Duration = Duration::from_millis(500);
/// 40 questions of up to 200 options would still fit far below this.
const RAW_MAX_BYTES: usize = 2_000_000;
pub const MAX_QUESTIONS: usize = 40;
const MAX_VALUES: usize = 200;
const MAX_TEXT_CHARS: usize = 500;
const MAX_ANSWER_CHARS: usize = 4_000;

/// B787: an answer the candidate confirmed, by the question's own text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HhAnswer {
    pub text: String,
    pub values: Vec<String>,
}

/// A consent box the app ticked: the employer's own words and the linked policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HhConsent {
    pub text: String,
    pub url: Option<String>,
}

pub fn valid_answers(answers: &[HhAnswer]) -> bool {
    answers.len() <= MAX_QUESTIONS * 2
        && answers.iter().all(|answer| {
            !answer.text.trim().is_empty()
                && answer.text.chars().count() <= MAX_TEXT_CHARS
                && answer.values.len() <= MAX_VALUES
                && answer
                    .values
                    .iter()
                    .all(|v| !v.trim().is_empty() && v.chars().count() <= MAX_ANSWER_CHARS)
        })
}

/// The reading script with the filling step in it; the answers enter only as a JSON literal.
pub fn fill_script(answers: &[HhAnswer], consent: bool) -> String {
    let act = serde_json::json!({ "answers": answers, "consent": consent }).to_string();
    let fill = FILL_SCRIPT.replacen(ANSWERS_MARK, &act, 1);
    PAGE_SCRIPT.replacen(ACT_MARK, &fill, 1)
}

#[derive(Deserialize)]
struct FillAnswer {
    code: String,
    #[serde(default)]
    consents: Vec<HhConsent>,
}

/// Fills the open form and answers once it holds every answer; never submits. `Err` is a code.
pub async fn fill_questionnaire(
    window: &tauri::Webview,
    answers: &[HhAnswer],
    consent: bool,
) -> Result<Vec<HhConsent>, String> {
    let script = fill_script(answers, consent);
    let deadline = tokio::time::Instant::now() + READ_WAIT;
    loop {
        match eval_json(window, &script).await {
            Ok(raw) => match serde_json::from_str::<FillAnswer>(&raw) {
                Ok(answer) if answer.code == "filled" => return Ok(answer.consents),
                Ok(answer) if answer.code != "waiting" => return Err(answer.code),
                Ok(_) => {}
                Err(_) => return Err("step_shape".into()),
            },
            Err(error) if is_transient_eval_error(&error) => {}
            Err(_) => return Err("script_error".into()),
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("answers_not_kept".into());
        }
        tokio::time::sleep(READ_POLL).await;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HhQuestion {
    pub text: String,
    pub required: bool,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiple: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HhQuestionnaire {
    /// hh.ru's page with the form; the server keeps only its vacancy number.
    pub url: String,
    /// Empty: the form could not be read.
    pub questions: Vec<HhQuestion>,
}

#[derive(Deserialize)]
struct PageAnswer {
    code: String,
    #[serde(default)]
    questions: Vec<HhQuestion>,
}

/// `Some` once the page answered for good; an empty list means "not readable".
pub fn parse_answer(raw: &str) -> Option<Vec<HhQuestion>> {
    if raw.len() > RAW_MAX_BYTES {
        return Some(Vec::new());
    }
    match serde_json::from_str::<PageAnswer>(raw) {
        Ok(answer) if answer.code == "read" && answer.questions.len() <= MAX_QUESTIONS => {
            Some(answer.questions)
        }
        Ok(answer) if answer.code == "waiting" => None,
        _ => Some(Vec::new()),
    }
}

/// Reads until two looks in a row agree: a form still drawing is not an answer.
pub async fn read_questionnaire(window: &tauri::Webview, url: String) -> HhQuestionnaire {
    let deadline = tokio::time::Instant::now() + READ_WAIT;
    let mut last: Option<Vec<HhQuestion>> = None;
    loop {
        let seen = match eval_json(window, PAGE_SCRIPT).await {
            Ok(raw) => parse_answer(&raw),
            Err(error) if is_transient_eval_error(&error) => None,
            Err(_) => Some(Vec::new()),
        };
        if let Some(questions) = &seen {
            if !questions.is_empty() && seen == last {
                return HhQuestionnaire {
                    url,
                    questions: questions.clone(),
                };
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return HhQuestionnaire {
                url,
                questions: Vec::new(),
            };
        }
        last = seen;
        tokio::time::sleep(READ_POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_a_complete_answer() {
        let read = r#"{"code":"read","questions":[{"text":"А?","required":true,"kind":"choice","options":["Да","Нет"]}]}"#;
        assert_eq!(parse_answer(read).expect("settled").len(), 1);
        assert_eq!(parse_answer(r#"{"code":"waiting","questions":[]}"#), None);
        for bad in [
            r#"{"code":"unreadable","questions":[]}"#,
            r#"{"code":"read","questions":[{"text":"А?"}]}"#,
            "null",
            "",
        ] {
            assert_eq!(parse_answer(bad), Some(Vec::new()), "{bad}");
        }
    }

    #[test]
    fn the_answers_enter_the_script_as_one_json_literal() {
        assert_eq!(PAGE_SCRIPT.matches(ACT_MARK).count(), 1);
        assert_eq!(FILL_SCRIPT.matches(ANSWERS_MARK).count(), 1);
        let tricky = HhAnswer {
            text: "А?".into(),
            values: vec!["\"};alert(1)//__OQ_ANSWERS__".into()],
        };
        let script = fill_script(&[tricky], false);
        assert!(script.contains(r#"\"};alert(1)//__OQ_ANSWERS__"#));
        assert!(!script.contains(ACT_MARK));
        for call in [
            "fetch(",
            "XMLHttpRequest",
            "requestSubmit",
            ".submit(",
            "location.assign",
        ] {
            assert!(!script.contains(call), "{call}");
        }
    }

    #[test]
    fn answers_are_bounded() {
        let answer = |text: &str, value: &str| HhAnswer {
            text: text.into(),
            values: vec![value.into()],
        };
        assert!(valid_answers(&[answer("А?", "Да")]));
        assert!(!valid_answers(&[answer(" ", "Да")]));
        assert!(!valid_answers(&[answer("А?", " ")]));
        assert!(!valid_answers(&[answer(
            "А?",
            &"я".repeat(MAX_ANSWER_CHARS + 1)
        )]));
        assert!(!valid_answers(&vec![
            answer("А?", "Да");
            MAX_QUESTIONS * 2 + 1
        ]));
    }

    #[test]
    fn the_script_never_acts_on_the_page() {
        for call in [
            ".click(",
            ".submit(",
            "requestSubmit",
            "dispatchEvent",
            ".focus(",
            "fetch(",
            "XMLHttpRequest",
            "location.href",
            "location.assign",
            ".value=",
        ] {
            assert!(!PAGE_SCRIPT.contains(call), "{call}");
        }
    }
}
