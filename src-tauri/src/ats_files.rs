//! B787: which candidate files the form engine may attach. Anything the form
//! field or this list does not name is refused before it reaches the page.

use crate::ats_model::FileValue;
use base64::{engine::general_purpose::STANDARD, Engine as _};

pub const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 200;

const KINDS: &[(&str, &[&str])] = &[
    ("pdf", &["application/pdf"]),
    ("doc", &["application/msword"]),
    (
        "docx",
        &["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ),
    ("txt", &["text/plain"]),
    ("rtf", &["application/rtf", "text/rtf"]),
];

fn extension(name: &str) -> Option<String> {
    let (stem, extension) = name.rsplit_once('.')?;
    let plain = !stem.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && !name
            .chars()
            .any(|char| char.is_control() || matches!(char, '/' | '\\'));
    plain.then(|| extension.to_ascii_lowercase())
}

/// The `accept` attribute as a browser reads it; empty accepts every file.
fn accepted_by_field(accept: Option<&str>, extension: &str, mime: &str) -> bool {
    let accept = accept.unwrap_or_default().to_ascii_lowercase();
    let mut tokens = accept
        .split(',')
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .peekable();
    tokens.peek().is_none()
        || tokens.any(|token| match token.strip_prefix('.') {
            Some(named) => named == extension,
            None => {
                token == "*/*"
                    || token == mime
                    || token
                        .strip_suffix('*')
                        .is_some_and(|family| family.ends_with('/') && mime.starts_with(family))
            }
        })
}

pub fn validate_file(file: &FileValue, accept: Option<&str>) -> Result<(), &'static str> {
    let extension = extension(&file.name).ok_or("ats_file_name")?;
    let mime = file.mime.to_ascii_lowercase();
    let known = KINDS
        .iter()
        .any(|(kind, mimes)| *kind == extension && mimes.contains(&mime.as_str()));
    if !known {
        return Err("ats_file_type");
    }
    // Four base64 characters carry three bytes: too long a text is not decoded.
    if file.base64.len() > MAX_FILE_BYTES.div_ceil(3) * 4 {
        return Err("ats_file_size");
    }
    let bytes = STANDARD
        .decode(&file.base64)
        .map_err(|_| "ats_file_encoding")?;
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("ats_file_size");
    }
    if !accepted_by_field(accept, &extension, &mime) {
        return Err("ats_file_not_accepted");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, mime: &str, base64: &str) -> FileValue {
        FileValue {
            name: name.into(),
            mime: mime.into(),
            base64: base64.into(),
        }
    }

    #[test]
    fn only_resume_formats_with_their_own_type_pass() {
        for (name, mime) in [
            ("cv.pdf", "application/pdf"),
            ("CV.DOC", "application/msword"),
            (
                "Резюме.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            ("cv.txt", "text/plain"),
            ("cv.rtf", "application/rtf"),
            ("cv.rtf", "text/rtf"),
        ] {
            assert_eq!(
                validate_file(&file(name, mime, "AAAA"), None),
                Ok(()),
                "{name}"
            );
        }
        for (name, mime, reason) in [
            ("cv.html", "text/html", "ats_file_type"),
            ("cv.pdf", "text/html", "ats_file_type"),
            ("cv.pdf.exe", "application/pdf", "ats_file_type"),
            ("cv", "application/pdf", "ats_file_name"),
            (".pdf", "application/pdf", "ats_file_name"),
            ("../cv.pdf", "application/pdf", "ats_file_name"),
        ] {
            assert_eq!(
                validate_file(&file(name, mime, "AAAA"), None),
                Err(reason),
                "{name}"
            );
        }
    }

    #[test]
    fn the_content_is_real_base64_of_a_bounded_size() {
        let pdf = |base64: &str| validate_file(&file("cv.pdf", "application/pdf", base64), None);
        assert_eq!(pdf(""), Err("ats_file_size"));
        for broken in ["AAA", "A A=", "data:application/pdf;base64,AAAA", "\"}//"] {
            assert_eq!(pdf(broken), Err("ats_file_encoding"), "{broken}");
        }
        assert_eq!(pdf(&STANDARD.encode(vec![0; MAX_FILE_BYTES])), Ok(()));
        assert_eq!(
            pdf(&STANDARD.encode(vec![0; MAX_FILE_BYTES + 1])),
            Err("ats_file_size")
        );
    }

    #[test]
    fn the_field_s_own_accept_list_is_obeyed() {
        let pdf = file("cv.pdf", "application/pdf", "AAAA");
        for accept in [
            None,
            Some(""),
            Some(".doc, .PDF"),
            Some("application/pdf"),
            Some("application/*"),
            Some("*/*"),
        ] {
            assert_eq!(validate_file(&pdf, accept), Ok(()), "{accept:?}");
        }
        for accept in [".docx", "image/*", "text/plain", "*"] {
            assert_eq!(
                validate_file(&pdf, Some(accept)),
                Err("ats_file_not_accepted"),
                "{accept}"
            );
        }
    }
}
