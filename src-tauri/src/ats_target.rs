//! B787: which employer form a vacancy address leads to, and the exact hosts
//! the form window may visit for it. The list is built per vacancy; nothing
//! outside it loads at the top level, so the window never becomes a browser.

use tauri::Url;

/// Frames a form page itself loads for its own check. They are allowed to
/// load so the candidate can pass the check in the shown window; the app
/// never answers one.
const CHECK_FRAMES: &[(&str, &str)] = &[
    ("www.google.com", "/recaptcha"),
    ("www.recaptcha.net", "/recaptcha"),
    ("www.gstatic.com", "/recaptcha"),
    ("newassets.hcaptcha.com", "/captcha"),
    ("geo.captcha-delivery.com", "/captcha"),
    ("captcha-assets.recruiteecdn.com", "/captcha"),
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
    /// The host of `entry_url` and, for Greenhouse, the one host it moves to.
    pub hosts: Vec<String>,
    /// The path the board shows after it accepted the application.
    /// Empty when the board is not known to have one: nothing then confirms.
    pub confirmation_path: String,
    /// The one address outside the form's own path that its button posts to.
    pub post_path: Option<String>,
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

/// A path spelled so that its segments are not what they look like. Checked on
/// the raw text: parsing already folds `..` away.
fn has_disguised_path(url: &str) -> bool {
    let Some((_, rest)) = url.split_once("://") else {
        return true;
    };
    let rest = rest.split(['?', '#']).next().unwrap_or_default();
    let lower = rest.to_ascii_lowercase();
    lower
        .split('/')
        .any(|segment| matches!(segment, "." | ".."))
        || ["%2e", "%2f", "%5c", "\\"]
            .iter()
            .any(|part| lower.contains(part))
}

fn https(url: &str) -> Option<Url> {
    if has_disguised_path(url) {
        return None;
    }
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
        // Either host of the pair answers with the other; the path stays the same.
        hosts: hosts.iter().map(|host| (*host).to_string()).collect(),
        confirmation_path: format!("{path}/confirmation"),
        post_path: None,
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
    if let Some(target) = crate::ats_boards::resolve(&parsed, board) {
        return target;
    }
    match (query(&parsed, "gh_jid"), board) {
        (Some(job_id), Some(token)) => greenhouse(GREENHOUSE_HOSTS, token, &job_id),
        (Some(_), None) => Err("ats_board_unknown".to_string()),
        _ => Err("ats_unsupported".to_string()),
    }
}

/// What the window itself, not a frame in it, may show.
pub fn top_level_allowed(target: &AtsTarget, url: &str) -> bool {
    url == "about:blank" || on_target(target, url) || is_post(target, url)
}

fn is_check_frame(url: &str) -> bool {
    https(url).is_some_and(|parsed| {
        CHECK_FRAMES
            .iter()
            .any(|(host, base)| Some(*host) == parsed.host_str() && within(parsed.path(), base))
    })
}

/// The navigation rule. macOS asks it for frames as well and does not say which
/// one it is, so a check address that reaches the top level is stopped by the
/// page-load rule (`top_level_allowed`). Elsewhere only the top level is asked.
pub fn navigation_allowed(target: &AtsTarget, url: &str) -> bool {
    top_level_allowed(target, url) || (cfg!(target_os = "macos") && is_check_frame(url))
}

fn is_post(target: &AtsTarget, url: &str) -> bool {
    target
        .post_path
        .as_deref()
        .is_some_and(|path| on_target_host(target, url).is_some_and(|next| next.path() == path))
}

fn on_target_host(target: &AtsTarget, url: &str) -> Option<Url> {
    https(url).filter(|parsed| {
        target
            .hosts
            .iter()
            .any(|host| Some(host.as_str()) == parsed.host_str())
    })
}

/// `path` is `base` itself or lies below it: `/jobs/123` never covers `/jobs/1234`.
fn within(path: &str, base: &str) -> bool {
    let base = base.trim_end_matches('/');
    !base.is_empty()
        && path
            .strip_prefix(base)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// Parameters of the entry address name the vacancy: each must keep its one value.
fn same_identity(entry: &Url, next: &Url) -> bool {
    entry.query_pairs().all(|(key, value)| {
        let mut found = next.query_pairs().filter(|(name, _)| *name == key);
        found.next().is_some_and(|(_, held)| held == value) && found.next().is_none()
    })
}

/// The page the window ended on is the form of this very vacancy or the page
/// its board shows after accepting the application.
pub fn on_target(target: &AtsTarget, url: &str) -> bool {
    let Some(next) = on_target_host(target, url) else {
        return false;
    };
    let Some(entry) = https(&target.entry_url) else {
        return false;
    };
    is_confirmation(target, url)
        || (within(next.path(), entry.path()) && same_identity(&entry, &next))
}

/// The board's own confirmation page for this vacancy.
pub fn is_confirmation(target: &AtsTarget, url: &str) -> bool {
    !target.confirmation_path.is_empty()
        && on_target_host(target, url).is_some_and(|next| {
            next.path().trim_end_matches('/') == target.confirmation_path.trim_end_matches('/')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_board_page_opens_as_itself_with_only_its_host() {
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

    const ENTRY: &str = "https://job-boards.greenhouse.io/acme/jobs/123";

    fn acme() -> AtsTarget {
        resolve(ENTRY, None).unwrap()
    }

    #[test]
    fn the_window_stays_on_its_vacancy_its_confirmation_and_check_frames() {
        for url in [
            "about:blank",
            ENTRY,
            "https://job-boards.greenhouse.io/acme/jobs/123/",
            "https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x#app",
            "https://job-boards.greenhouse.io/acme/jobs/123/confirmation",
        ] {
            assert!(navigation_allowed(&acme(), url), "{url}");
        }
        // Only macOS asks the rule for frames too.
        assert_eq!(
            navigation_allowed(
                &acme(),
                "https://www.recaptcha.net/recaptcha/enterprise/anchor"
            ),
            cfg!(target_os = "macos")
        );
        assert!(!on_target(&acme(), "about:blank"));
        assert!(!on_target(
            &acme(),
            "https://www.recaptcha.net/recaptcha/enterprise/anchor"
        ));
    }

    #[test]
    fn another_vacancy_board_host_or_a_disguised_address_is_off_target() {
        for url in [
            "https://job-boards.greenhouse.io/acme/jobs/1234",
            "https://job-boards.greenhouse.io/acme/jobs/12",
            "https://job-boards.greenhouse.io/acme/jobs/124",
            "https://job-boards.greenhouse.io/acme",
            "https://job-boards.greenhouse.io/other/jobs/123",
            "https://job-boards.greenhouse.io/other/jobs/123/confirmation",
            "https://job-boards.greenhouse.io/x/acme/jobs/123",
            "https://job-boards.greenhouse.io//acme/jobs/123",
            "https://job-boards.greenhouse.io/acme/jobs/123/../124",
            "https://job-boards.greenhouse.io/acme/jobs/124/../123",
            "https://job-boards.greenhouse.io/acme/jobs/123/%2e%2e/124",
            "https://job-boards.greenhouse.io/acme/jobs/123%2F..%2F124",
            "https://job-boards.greenhouse.io/acme/jobs/123\\..\\124",
            "https://job-boards.greenhouse.io:8443/acme/jobs/123",
            "https://user@job-boards.greenhouse.io/acme/jobs/123",
            "https://job-boards.greenhouse.io.example/acme/jobs/123",
            "http://job-boards.greenhouse.io/acme/jobs/123",
            "https://my.greenhouse.io/users/sign_in",
            "https://acme.example/",
            "javascript:alert(1)",
        ] {
            assert!(!on_target(&acme(), url), "{url}");
            assert!(!navigation_allowed(&acme(), url), "{url}");
        }
    }

    #[test]
    fn a_vacancy_named_by_parameters_keeps_every_one_of_them() {
        let target = AtsTarget {
            adapter: "greenhouse",
            entry_url: "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123".into(),
            hosts: vec!["job-boards.greenhouse.io".into()],
            confirmation_path: "/embed/job_app/confirmation".into(),
            post_path: None,
        };
        let at = |query: &str| {
            on_target(
                &target,
                &format!("https://job-boards.greenhouse.io/embed/job_app{query}"),
            )
        };
        assert!(at("?token=123&for=acme&x=1"));
        assert!(!at("?for=acme&token=124"));
        assert!(!at("?for=other&token=123"));
        assert!(!at("?for=acme&token=123&token=124"));
        assert!(!at("?for=acme"));
    }

    #[test]
    fn only_the_exact_confirmation_path_confirms() {
        let at = |path: &str| {
            is_confirmation(&acme(), &format!("https://job-boards.greenhouse.io{path}"))
        };
        assert!(at("/acme/jobs/123/confirmation"));
        assert!(at("/acme/jobs/123/confirmation/?x=1"));
        assert!(!at("/acme/jobs/123"));
        assert!(!at("/acme/jobs/1234/confirmation"));
        assert!(!at("/acme/jobs/123/confirmation2"));
        assert!(!at("/x/acme/jobs/123/confirmation"));
    }

    #[test]
    fn a_greenhouse_vacancy_stays_itself_across_its_two_hosts_only() {
        let pairs = [
            (
                "job-boards.greenhouse.io",
                "boards.greenhouse.io",
                "boards.eu.greenhouse.io",
            ),
            (
                "job-boards.eu.greenhouse.io",
                "boards.eu.greenhouse.io",
                "boards.greenhouse.io",
            ),
        ];
        for (new, old, foreign) in pairs {
            let target = resolve(&format!("https://{old}/acme/jobs/12"), None).unwrap();
            for host in [new, old] {
                assert!(on_target(&target, &format!("https://{host}/acme/jobs/12")));
                assert!(is_confirmation(
                    &target,
                    &format!("https://{host}/acme/jobs/12/confirmation")
                ));
                for path in ["acme/jobs/123", "other/jobs/12", "acme", "acme/jobs"] {
                    let url = format!("https://{host}/{path}");
                    assert!(!navigation_allowed(&target, &url), "{url}");
                }
            }
            assert!(!navigation_allowed(
                &target,
                &format!("https://{foreign}/acme/jobs/12")
            ));
        }
    }

    #[test]
    fn the_post_address_is_passed_through_but_is_not_the_vacancy() {
        let target = resolve("https://acme.teamtailor.com/jobs/8-x", None).unwrap();
        let post = "https://acme.teamtailor.com/applications";
        assert!(navigation_allowed(&target, post) && !on_target(&target, post));
        assert!(!is_confirmation(&target, post));
        assert!(!navigation_allowed(
            &target,
            "https://acme.teamtailor.com/applications/5"
        ));
        assert!(!navigation_allowed(
            &target,
            "https://other.teamtailor.com/applications"
        ));
    }

    #[test]
    fn a_check_lives_only_in_a_frame_and_only_on_its_own_path() {
        for url in [
            "https://www.google.com/recaptcha/enterprise/anchor",
            "https://www.gstatic.com/recaptcha/releases/x",
            "https://www.recaptcha.net/recaptcha/enterprise/bframe",
            "https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html",
        ] {
            assert!(!top_level_allowed(&acme(), url), "{url}");
            assert_eq!(
                navigation_allowed(&acme(), url),
                cfg!(target_os = "macos"),
                "{url}"
            );
        }
        for url in [
            "https://www.google.com/",
            "https://www.google.com/search?q=x",
            "https://www.google.com/recaptchas",
            "https://www.gstatic.com/x",
        ] {
            assert!(!navigation_allowed(&acme(), url), "{url}");
        }
        assert!(top_level_allowed(&acme(), "about:blank"));
        assert!(top_level_allowed(&acme(), &acme().entry_url));
    }
}
