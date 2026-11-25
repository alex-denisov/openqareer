//! B787: a SmartRecruiters posting address carries a number, its form a uuid.
//! The public posting API of the board names the uuid; nothing about the
//! candidate is sent.

use serde_json::Value;
use std::time::Duration;
use tauri::Url;

const HOST: &str = "jobs.smartrecruiters.com";
const API: &str = "https://api.smartrecruiters.com/v1/companies";
const WAIT: Duration = Duration::from_secs(15);
const MAX_BYTES: usize = 512 * 1024;

/// Company and posting number of a posting address; `None` for any other address.
fn posting_of(url: &str) -> Option<(String, String)> {
    let parsed = Url::parse(url).ok()?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(HOST) {
        return None;
    }
    let parts: Vec<&str> = parsed
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let [company, slug] = parts.as_slice() else {
        return None;
    };
    let id = slug.split('-').next().unwrap_or_default();
    let known = (6..=20).contains(&id.len())
        && id.bytes().all(|byte| byte.is_ascii_digit())
        && !company.is_empty()
        && company.len() <= 120
        && company
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte));
    known.then(|| (company.to_string(), id.to_string()))
}

/// The answer must be about this very posting of this company.
fn form_of(company: &str, id: &str, answer: &Value) -> Option<String> {
    let same = answer["id"].as_str() == Some(id)
        && answer["company"]["identifier"]
            .as_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(company));
    let uuid = answer["uuid"].as_str().filter(|_| same)?;
    Some(format!(
        "https://{HOST}/oneclick-ui/company/{company}/publication/{uuid}"
    ))
}

async fn read_posting(company: &str, id: &str) -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(WAIT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let mut answer = client
        .get(format!("{API}/{company}/postings/{id}"))
        .send()
        .await
        .ok()
        .filter(|answer| answer.status().is_success())?;
    let mut body = Vec::new();
    while let Some(chunk) = answer.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_BYTES {
            return None;
        }
    }
    serde_json::from_slice(&body).ok()
}

/// The form address of a posting; any other address comes back as it is.
/// The result still goes through `ats_target::resolve`.
pub async fn form_address(url: &str) -> Result<String, String> {
    let Some((company, id)) = posting_of(url) else {
        return Ok(url.to_string());
    };
    read_posting(&company, &id)
        .await
        .and_then(|answer| form_of(&company, &id, &answer))
        .ok_or_else(|| "ats_posting_unavailable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_a_posting_address_is_looked_up() {
        let found =
            posting_of("https://jobs.smartrecruiters.com/Acme/744000163561569-engineer?x=1");
        assert_eq!(found, Some(("Acme".into(), "744000163561569".into())));
        for url in [
            "http://jobs.smartrecruiters.com/Acme/744000163561569",
            "https://jobs.smartrecruiters.com.evil.example/Acme/744000163561569",
            "https://jobs.smartrecruiters.com/Ac%2Fme/744000163561569",
            "https://jobs.smartrecruiters.com/Acme/engineer",
            "https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/1",
        ] {
            assert_eq!(posting_of(url), None, "{url}");
        }
    }

    #[test]
    fn an_answer_about_another_posting_or_company_gives_no_form() {
        let answer = |id: &str, company: &str| json!({ "id": id, "uuid": "u", "company": { "identifier": company } });
        assert!(form_of("Acme", "7", &answer("7", "ACME")).is_some());
        assert!(form_of("Acme", "7", &answer("8", "Acme")).is_none());
        assert!(form_of("Acme", "7", &answer("7", "Other")).is_none());
    }
}
