//! The desktop session token, kept by the app itself (B327).
//!
//! WebKit holds `localStorage` writes in memory and flushes them lazily; a quit
//! or a reinstall ended the process before the flush and signed the owner out
//! on every restart. This file is written synchronously on sign-in and read
//! back at start when WebKit lost the token. Readable by the user only (0600).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const TOKEN_FILE: &str = "session-token";
const MAX_TOKEN_LENGTH: usize = 1_024;

fn token_path(dir: &Path) -> PathBuf {
    dir.join(TOKEN_FILE)
}

fn is_valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= MAX_TOKEN_LENGTH
        && token.chars().all(|character| character.is_ascii_graphic())
}

pub fn read_token(dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(token_path(dir)).ok()?;
    let token = raw.trim();
    is_valid_token(token).then(|| token.to_string())
}

/// `None` removes the token (sign-out). Writes through a temp file and a rename
/// so a crash mid-write never leaves half a token behind.
pub fn write_token(dir: &Path, token: Option<&str>) -> Result<(), String> {
    let path = token_path(dir);
    let Some(token) = token else {
        return match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("session_token_remove_failed".to_string()),
        };
    };
    if !is_valid_token(token) {
        return Err("session_token_invalid".to_string());
    }
    fs::create_dir_all(dir).map_err(|_| "session_token_dir_failed".to_string())?;
    let temp = dir.join(format!("{TOKEN_FILE}.tmp"));
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|_| "session_token_write_failed".to_string())?;
    file.write_all(token.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|_| "session_token_write_failed".to_string())?;
    fs::rename(&temp, &path).map_err(|_| "session_token_write_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("oq-token-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn keeps_the_token_across_reads_and_removes_it_on_sign_out() {
        let dir = temp_dir("roundtrip");
        write_token(&dir, Some("abc.DEF-123")).unwrap();
        assert_eq!(read_token(&dir).as_deref(), Some("abc.DEF-123"));
        write_token(&dir, None).unwrap();
        assert_eq!(read_token(&dir), None);
        write_token(&dir, None).unwrap();
    }

    #[test]
    fn refuses_a_token_that_is_not_a_single_printable_word() {
        let dir = temp_dir("invalid");
        assert!(write_token(&dir, Some("two words")).is_err());
        assert!(write_token(&dir, Some("")).is_err());
        assert_eq!(read_token(&dir), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_readable_by_the_user_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        write_token(&dir, Some("secret")).unwrap();
        let mode = fs::metadata(token_path(&dir)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
