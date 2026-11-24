//! B787: which employer form a vacancy address leads to, and the exact hosts
//! the form window may visit for it. The list is built per vacancy; nothing
//! outside it loads at the top level, so the window never becomes a browser.

use tauri::Url;

/// Frames a form page itself loads for its own check. They are allowed to
/// load so the candidate can pass the check in the shown window; the app
/// never answers one.
const CHECK_FRAME_HOSTS: &[&str] = &[
    "www.google.com",
    "www.recaptcha.net",
    "www.gstatic.com",
    "newassets.hcaptcha.com",
    "captcha-assets.recruiteecdn.com",
];

const GREENHOUSE_HOSTS: &[&str] = &["job-boards.greenhouse.io", "boards.greenhouse.io"];
const GREENHOUSE_EU_HOSTS: &[&str] = &["job-boards.eu.greenhouse.io", "boards.eu.greenhouse.io"];
const TOKEN_MAX: usize = 80;
const JOB_ID_MAX: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtsTarget {
    pub adapter: &'static str,
    /// The board's own page with the form, never an employer page that frames it.
    pub entry_url: String,
    pub hosts: Vec<String>,
    /// The path the board shows after it accepted the application.
    pub confirmation_path: String,
}

fn is_board_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= TOKEN_MAX
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn is_job_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= JOB_ID_MAX
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn https(url: &str) -> Option<Url> {
    let parsed = Url::parse(url).ok()?;
    let plain = parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port_or_known_default() == Some(443);
    plain.then_some(parsed)
}

fn query(url: &Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn greenhouse(hosts: &[&str], token: &str, job_id: &str) -> Result<AtsTarget, String> {
    if !is_board_token(token) || !is_job_id(job_id) {
        return Err("ats_address_invalid".to_string());
    }
    let path = format!("/{token}/jobs/{job_id}");
    Ok(AtsTarget {
        adapter: "greenhouse",
        entry_url: format!("https://{}{path}", hosts[0]),
        hosts: hosts.iter().map(|host| (*host).to_string()).collect(),
        confirmation_path: format!("{path}/confirmation"),
    })
}

/// `board` is the Greenhouse board token the server knows for the vacancy; it
/// is needed only when the address is an employer page with `gh_jid`.
pub fn resolve(url: &str, board: Option<&str>) -> Result<AtsTarget, String> {
    let parsed = https(url).ok_or("ats_address_invalid")?;
    let host = parsed.host_str().unwrap_or_default();
    let family = [GREENHOUSE_HOSTS, GREENHOUSE_EU_HOSTS]
        .into_iter()
        .find(|hosts| hosts.contains(&host));
    if let Some(hosts) = family {
        let segments: Vec<&str> = parsed
            .path()
            .split('/')
            .filter(|part| !part.is_empty())
            .collect();
        return match segments.as_slice() {
            [token, "jobs", job_id] => greenhouse(hosts, token, job_id),
            ["embed", "job_app"] => greenhouse(
                hosts,
                &query(&parsed, "for").unwrap_or_default(),
                &query(&parsed, "token").unwrap_or_default(),
            ),
            _ => Err("ats_address_invalid".to_string()),
        };
    }
    if let Some(target) = crate::ats_boards::resolve(&parsed) {
        return target;
    }
    match (query(&parsed, "gh_jid"), board) {
        (Some(job_id), Some(token)) => greenhouse(GREENHOUSE_HOSTS, token, &job_id),
        (Some(_), None) => Err("ats_board_unknown".to_string()),
        _ => Err("ats_unsupported".to_string()),
    }
}

/// The form window's navigation rule, frames included.
pub fn navigation_allowed(hosts: &[String], url: &str) -> bool {
    if url == "about:blank" {
        return true;
    }
    let Some(parsed) = https(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default();
    hosts.iter().any(|allowed| allowed == host) || CHECK_FRAME_HOSTS.contains(&host)
}

/// The page the window ended on is still the vacancy's own board.
pub fn on_target(hosts: &[String], url: &str) -> bool {
    https(url).is_some_and(|parsed| {
        hosts
            .iter()
            .any(|allowed| Some(allowed.as_str()) == parsed.host_str())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_board_page_opens_as_itself_with_only_its_two_hosts() {
        let target = resolve(
            "https://job-boards.greenhouse.io/acme/jobs/4343866009?gh_src=x",
            None,
        )
        .unwrap();
        assert_eq!(target.adapter, "greenhouse");
        assert_eq!(
            target.entry_url,
            "https://job-boards.greenhouse.io/acme/jobs/4343866009"
        );
        assert_eq!(
            target.hosts,
            ["job-boards.greenhouse.io", "boards.greenhouse.io"]
        );
        assert_eq!(
            target.confirmation_path,
            "/acme/jobs/4343866009/confirmation"
        );
    }

    #[test]
    fn an_embedded_form_becomes_the_direct_board_address() {
        let frame = resolve(
            "https://boards.greenhouse.io/embed/job_app?for=acme&token=123",
            None,
        )
        .unwrap();
        assert_eq!(
            frame.entry_url,
            "https://job-boards.greenhouse.io/acme/jobs/123"
        );
        let site = resolve("https://acme.example/careers/role?gh_jid=123", Some("acme")).unwrap();
        assert_eq!(
            site.entry_url,
            "https://job-boards.greenhouse.io/acme/jobs/123"
        );
        assert!(!site.hosts.iter().any(|host| host == "acme.example"));
    }

    #[test]
    fn the_eu_board_keeps_its_own_hosts() {
        let target = resolve("https://boards.eu.greenhouse.io/acme/jobs/7", None).unwrap();
        assert_eq!(
            target.entry_url,
            "https://job-boards.eu.greenhouse.io/acme/jobs/7"
        );
        assert_eq!(
            target.hosts,
            ["job-boards.eu.greenhouse.io", "boards.eu.greenhouse.io"]
        );
    }

    #[test]
    fn an_unknown_or_crafted_address_is_refused() {
        for (url, board, reason) in [
            (
                "https://acme.example/careers?gh_jid=123",
                None,
                "ats_board_unknown",
            ),
            (
                "https://acme.example/careers",
                Some("acme"),
                "ats_unsupported",
            ),
            ("https://jobs.lever.co/acme/1", None, "ats_address_invalid"),
            (
                "http://boards.greenhouse.io/acme/jobs/1",
                None,
                "ats_address_invalid",
            ),
            (
                "https://user@boards.greenhouse.io/acme/jobs/1",
                None,
                "ats_address_invalid",
            ),
            (
                "https://boards.greenhouse.io/acme/jobs/1x",
                None,
                "ats_address_invalid",
            ),
            (
                "https://boards.greenhouse.io/a%2Fb/jobs/1",
                None,
                "ats_address_invalid",
            ),
            (
                "https://acme.example/?gh_jid=1",
                Some("../evil"),
                "ats_address_invalid",
            ),
            (
                "https://evil-boards.greenhouse.io.example/acme/jobs/1",
                None,
                "ats_unsupported",
            ),
        ] {
            assert_eq!(resolve(url, board).unwrap_err(), reason, "{url}");
        }
    }

    #[test]
    fn the_window_visits_only_the_listed_hosts_and_check_frames() {
        let hosts = resolve("https://boards.greenhouse.io/acme/jobs/1", None)
            .unwrap()
            .hosts;
        for url in [
            "about:blank",
            "https://boards.greenhouse.io/acme/jobs/1/confirmation",
            "https://job-boards.greenhouse.io/acme/jobs/1",
            "https://www.recaptcha.net/recaptcha/enterprise/anchor",
        ] {
            assert!(navigation_allowed(&hosts, url), "{url}");
        }
        for url in [
            "https://my.greenhouse.io/users/sign_in",
            "https://app.greenhouse.io/",
            "https://boards.greenhouse.io.example/acme",
            "http://boards.greenhouse.io/acme/jobs/1",
            "https://acme.example/",
            "javascript:alert(1)",
        ] {
            assert!(!navigation_allowed(&hosts, url), "{url}");
        }
        assert!(on_target(
            &hosts,
            "https://boards.greenhouse.io/acme/jobs/1/confirmation"
        ));
        assert!(!on_target(
            &hosts,
            "https://www.recaptcha.net/recaptcha/enterprise/anchor"
        ));
    }
}
