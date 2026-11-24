//! B787: the candidate's submit attempts, kept on disk so that a restart cannot
//! press the same employer's button twice. An attempt is written before the
//! press; without a stated refusal by the form it blocks the vacancy for good.
//! No field values are stored.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use uuid::Uuid;

const FILE: &str = "ats-attempts.json";
const TEMPORARY: &str = "ats-attempts.json.tmp";

/// The result names of the consent journal (`POST /apply-consents/:id/result`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttemptResult {
    Sent,
    /// The form itself refused: nothing left the page, a new attempt is allowed.
    Failed,
    Unconfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: Uuid,
    pub vacancy_id: String,
    pub entry_url: String,
    pub started_at_ms: u64,
    /// Entries of the consent journal written for this attempt.
    pub consent_ids: Vec<Uuid>,
    /// `None` — the app stopped between the press and its result.
    pub result: Option<AttemptResult>,
}

fn load(directory: &Path) -> Result<Vec<Attempt>, String> {
    match fs::read(directory.join(FILE)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "attempts_unreadable".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("attempts_unreadable".to_string()),
    }
}

fn save(directory: &Path, attempts: &[Attempt]) -> Result<(), String> {
    let write = || -> std::io::Result<()> {
        let temporary = directory.join(TEMPORARY);
        // A leftover of a crash, or a link someone put there: removed, never followed.
        match fs::remove_file(&temporary) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec(attempts)?)?;
        file.sync_all()?;
        fs::rename(&temporary, directory.join(FILE))?;
        #[cfg(unix)]
        fs::File::open(directory)?.sync_all()?;
        Ok(())
    };
    write().map_err(|_| "attempt_unrecorded".to_string())
}

fn blocks(attempt: &Attempt, vacancy_id: &str, entry_url: &str) -> bool {
    (attempt.vacancy_id == vacancy_id || attempt.entry_url == entry_url)
        && attempt.result != Some(AttemptResult::Failed)
}

pub fn is_blocked(directory: &Path, vacancy_id: &str, entry_url: &str) -> Result<bool, String> {
    Ok(load(directory)?
        .iter()
        .any(|attempt| blocks(attempt, vacancy_id, entry_url)))
}

/// Writes the attempt to disk; only after `Ok` may the button be pressed.
pub fn begin(directory: &Path, attempt: Attempt) -> Result<(), String> {
    let attempts = load(directory)?;
    let taken = attempts
        .iter()
        .any(|held| held.id == attempt.id || blocks(held, &attempt.vacancy_id, &attempt.entry_url));
    if taken {
        return Err("already_submitted".to_string());
    }
    let next: Vec<Attempt> = attempts.into_iter().chain([attempt]).collect();
    save(directory, &next)
}

/// A confirmed sending is never overwritten by a later, weaker reading.
pub fn finish(directory: &Path, id: Uuid, result: AttemptResult) -> Result<(), String> {
    let next: Vec<Attempt> = load(directory)?
        .into_iter()
        .map(|attempt| {
            if attempt.id == id && attempt.result != Some(AttemptResult::Sent) {
                Attempt {
                    result: Some(result),
                    ..attempt
                }
            } else {
                attempt
            }
        })
        .collect();
    save(directory, &next)
}

pub fn latest(directory: &Path, vacancy_id: &str) -> Result<Option<Attempt>, String> {
    Ok(load(directory)?
        .into_iter()
        .rev()
        .find(|attempt| attempt.vacancy_id == vacancy_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("oq-attempts-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn attempt(vacancy: &str, url: &str) -> Attempt {
        Attempt {
            id: Uuid::new_v4(),
            vacancy_id: vacancy.into(),
            entry_url: url.into(),
            started_at_ms: 1,
            consent_ids: vec![Uuid::new_v4()],
            result: None,
        }
    }

    #[test]
    fn an_attempt_without_a_refusal_blocks_the_vacancy_after_a_restart() {
        for result in [
            None,
            Some(AttemptResult::Unconfirmed),
            Some(AttemptResult::Sent),
        ] {
            let folder = Folder::new();
            let first = attempt("v1", "https://a/1");
            begin(&folder.0, first.clone()).unwrap();
            if let Some(result) = result {
                finish(&folder.0, first.id, result).unwrap();
            }
            // Nothing is kept in memory: each call reads the disk as a new run would.
            assert!(is_blocked(&folder.0, "v1", "https://a/1").unwrap());
            for again in [attempt("v1", "https://a/2"), attempt("v2", "https://a/1")] {
                assert_eq!(
                    begin(&folder.0, again).unwrap_err(),
                    "already_submitted",
                    "{result:?}"
                );
            }
            begin(&folder.0, attempt("v3", "https://a/3")).unwrap();
            assert_eq!(latest(&folder.0, "v1").unwrap().unwrap().id, first.id);
        }
    }

    #[test]
    fn a_stated_refusal_allows_a_new_attempt_but_not_the_same_one() {
        let folder = Folder::new();
        let first = attempt("v1", "https://a/1");
        begin(&folder.0, first.clone()).unwrap();
        finish(&folder.0, first.id, AttemptResult::Failed).unwrap();
        assert!(begin(&folder.0, first).is_err());
        begin(&folder.0, attempt("v1", "https://a/1")).unwrap();
    }

    #[test]
    fn a_confirmed_sending_stays_confirmed() {
        let folder = Folder::new();
        let first = attempt("v1", "https://a/1");
        begin(&folder.0, first.clone()).unwrap();
        finish(&folder.0, first.id, AttemptResult::Sent).unwrap();
        finish(&folder.0, first.id, AttemptResult::Failed).unwrap();
        assert!(is_blocked(&folder.0, "v1", "https://a/1").unwrap());
    }

    #[test]
    fn an_unreadable_or_unwritable_record_forbids_the_press() {
        let folder = Folder::new();
        fs::write(folder.0.join(FILE), b"{broken").unwrap();
        assert!(begin(&folder.0, attempt("v1", "https://a/1")).is_err());
        assert!(is_blocked(&folder.0, "v1", "https://a/1").is_err());
        let missing = folder.0.join("absent");
        assert_eq!(
            begin(&missing, attempt("v1", "https://a/1")).unwrap_err(),
            "attempt_unrecorded"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_the_temporary_file_is_not_followed() {
        let folder = Folder::new();
        let victim = folder.0.join("victim");
        fs::write(&victim, "kept").unwrap();
        std::os::unix::fs::symlink(&victim, folder.0.join(TEMPORARY)).unwrap();
        begin(&folder.0, attempt("v1", "https://a.example/1")).unwrap();
        assert_eq!(fs::read_to_string(&victim).unwrap(), "kept");
        assert!(!fs::symlink_metadata(folder.0.join(FILE))
            .unwrap()
            .is_symlink());
        assert!(is_blocked(&folder.0, "v1", "https://a.example/1").unwrap());
    }
}
