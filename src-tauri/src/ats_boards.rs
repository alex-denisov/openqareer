//! B787: board families beside Greenhouse. Each address becomes the board's own
//! form page, the one host it lives on and the path shown after acceptance.

use crate::ats_target::AtsTarget;
use tauri::Url;

const TOKEN_MAX: usize = 120;

fn is_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= TOKEN_MAX
        && value.starts_with(|first: char| first.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-.".contains(&byte))
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(at, byte)| match at {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

fn target(
    adapter: &'static str,
    host: &str,
    entry_path: &str,
    confirmation_path: String,
) -> AtsTarget {
    AtsTarget {
        adapter,
        entry_url: format!("https://{host}{entry_path}"),
        hosts: vec![host.to_string()],
        confirmation_path,
    }
}

fn ashby(host: &str, parts: &[&str]) -> Option<AtsTarget> {
    let [board, job, rest @ ..] = parts else {
        return None;
    };
    let known = matches!(rest, [] | ["application"]);
    if !known || !is_token(board) || !is_uuid(job) {
        return None;
    }
    let path = format!("/{board}/{job}/application");
    // The board confirms in place: the form gives way to its own message.
    Some(target("ashby", host, &path, format!("{path}/submitted")))
}

fn lever(host: &str, parts: &[&str]) -> Option<AtsTarget> {
    let [board, job, rest @ ..] = parts else {
        return None;
    };
    let known = matches!(rest, [] | ["apply"] | ["thanks"]);
    if !known || !is_token(board) || !is_uuid(job) {
        return None;
    }
    Some(target(
        "lever",
        host,
        &format!("/{board}/{job}/apply"),
        format!("/{board}/{job}/thanks"),
    ))
}

fn recruitee(host: &str, parts: &[&str]) -> Option<AtsTarget> {
    let ["o", job, rest @ ..] = parts else {
        return None;
    };
    if !matches!(rest, [] | ["c", "new"]) || !is_token(job) {
        return None;
    }
    let path = format!("/o/{job}/c/new");
    Some(target(
        "recruitee",
        host,
        &path,
        format!("{path}/submitted"),
    ))
}

fn teamtailor(host: &str, parts: &[&str]) -> Option<AtsTarget> {
    let ["jobs", job, rest @ ..] = parts else {
        return None;
    };
    let numbered = job.starts_with(|first: char| first.is_ascii_digit());
    if !matches!(rest, [] | ["applications", "new"]) || !is_token(job) || !numbered {
        return None;
    }
    let path = format!("/jobs/{job}/applications");
    Some(target(
        "teamtailor",
        host,
        &format!("{path}/new"),
        format!("{path}/submitted"),
    ))
}

fn workable(host: &str, parts: &[&str]) -> Option<AtsTarget> {
    let (company, job, rest) = match parts {
        ["j", job, rest @ ..] => (None, job, rest),
        [company, "j", job, rest @ ..] => (Some(company), job, rest),
        _ => return None,
    };
    let sound = company.is_none_or(|name| is_token(name)) && is_token(job);
    if !sound || !matches!(rest, [] | ["apply"]) {
        return None;
    }
    let path = match company {
        Some(company) => format!("/{company}/j/{job}/apply"),
        None => format!("/j/{job}/apply"),
    };
    Some(target("workable", host, &path, format!("{path}/submitted")))
}

fn pinpoint(host: &str, parts: &[&str]) -> Option<AtsTarget> {
    let (prefix, job, rest) = match parts {
        ["postings", job, rest @ ..] => (String::new(), job, rest),
        [locale, "postings", job, rest @ ..] if is_token(locale) => {
            (format!("/{locale}"), job, rest)
        }
        _ => return None,
    };
    if !is_uuid(job) || !matches!(rest, [] | ["applications", "new"]) {
        return None;
    }
    let path = format!("{prefix}/postings/{job}/applications");
    Some(target(
        "pinpoint",
        host,
        &format!("{path}/new"),
        format!("{path}/submitted"),
    ))
}

/// `None` when the host is not one of these boards.
pub fn resolve(url: &Url) -> Option<Result<AtsTarget, String>> {
    let host = url.host_str()?;
    let parts: Vec<&str> = url
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let company = |suffix: &str| {
        host.strip_suffix(suffix)
            .is_some_and(|name| is_token(name) && !name.contains('.') && name != "www")
    };
    let found = match host {
        "jobs.ashbyhq.com" => ashby(host, &parts),
        "jobs.lever.co" | "jobs.eu.lever.co" => lever(host, &parts),
        "apply.workable.com" => workable(host, &parts),
        _ if company(".pinpointhq.com") => pinpoint(host, &parts),
        _ if company(".recruitee.com") => recruitee(host, &parts),
        _ if company(".teamtailor.com") => teamtailor(host, &parts),
        _ => return None,
    };
    Some(found.ok_or_else(|| "ats_address_invalid".to_string()))
}

#[cfg(test)]
mod tests {
    use crate::ats_target::resolve;

    const JOB: &str = "fca52e03-9e9d-4dcd-bda8-c27dbdd0e0a4";

    #[test]
    fn every_board_opens_its_own_form_on_one_host() {
        let ashby = format!("https://jobs.ashbyhq.com/acme/{JOB}");
        let lever = format!("https://jobs.eu.lever.co/acme/{JOB}");
        let cases = [
            (
                format!("{ashby}?utm=x"),
                "ashby",
                format!("{ashby}/application"),
            ),
            (
                format!("{ashby}/application"),
                "ashby",
                format!("{ashby}/application"),
            ),
            (lever.clone(), "lever", format!("{lever}/apply")),
            (
                "https://apply.workable.com/acme/j/81B4".into(),
                "workable",
                "https://apply.workable.com/acme/j/81B4/apply".into(),
            ),
            (
                format!("https://acme.pinpointhq.com/en/postings/{JOB}"),
                "pinpoint",
                format!("https://acme.pinpointhq.com/en/postings/{JOB}/applications/new"),
            ),
            (
                "https://acme.recruitee.com/o/engineer-3".into(),
                "recruitee",
                "https://acme.recruitee.com/o/engineer-3/c/new".into(),
            ),
            (
                "https://acme.teamtailor.com/jobs/877-tech".into(),
                "teamtailor",
                "https://acme.teamtailor.com/jobs/877-tech/applications/new".into(),
            ),
        ];
        for (url, adapter, entry) in cases {
            let target = resolve(&url, None).unwrap();
            assert_eq!(target.adapter, adapter);
            assert_eq!(target.entry_url, entry);
            assert_eq!(target.hosts.len(), 1, "{url}");
            assert!(
                !target.entry_url.ends_with(&target.confirmation_path),
                "{url}"
            );
        }
        let target = resolve(&lever, None).unwrap();
        assert_eq!(target.confirmation_path, format!("/acme/{JOB}/thanks"));
    }

    #[test]
    fn other_pages_of_the_same_hosts_are_refused() {
        for url in [
            "https://jobs.ashbyhq.com/acme".to_string(),
            "https://jobs.ashbyhq.com/acme/1".to_string(),
            format!("https://jobs.lever.co/acme/{JOB}/other"),
            format!("https://jobs.lever.co/..%2Fevil/{JOB}"),
            "https://acme.recruitee.com/admin".to_string(),
            "https://acme.teamtailor.com/jobs/new".to_string(),
        ] {
            assert_eq!(
                resolve(&url, None).unwrap_err(),
                "ats_address_invalid",
                "{url}"
            );
        }
        for url in [
            "https://a.b.recruitee.com/o/x",
            "https://www.teamtailor.com/jobs/1",
            "https://jobs.ashbyhq.com.evil.example/acme/1",
        ] {
            assert_eq!(resolve(url, None).unwrap_err(), "ats_unsupported", "{url}");
        }
    }
}
