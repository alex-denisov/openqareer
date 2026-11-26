//! The body of a native answer: text as it is, a file as base64 so its bytes survive.

use base64::{engine::general_purpose::STANDARD, Engine as _};

fn is_file_answer(content_type: &str) -> bool {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    ["image/", "audio/", "video/", "application/vnd."]
        .iter()
        .any(|family| mime.starts_with(family) && !mime.ends_with("json") && !mime.ends_with("xml"))
        || [
            "application/pdf",
            "application/octet-stream",
            "application/msword",
            "application/rtf",
            "application/zip",
        ]
        .contains(&mime.as_str())
}

/// `(text, base64)`: exactly one of them carries the answer.
pub async fn read(response: reqwest::Response) -> Result<(String, Option<String>), String> {
    let file = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|kind| kind.to_str().ok())
        .is_some_and(is_file_answer);
    if !file {
        return Ok((response.text().await.unwrap_or_default(), None));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Network error: {error}"))?;
    Ok((String::new(), Some(STANDARD.encode(&bytes))))
}

#[cfg(test)]
mod tests {
    use super::is_file_answer;

    #[test]
    fn only_files_travel_as_bytes() {
        for file in [
            "application/pdf",
            "Application/PDF; charset=binary",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/png",
        ] {
            assert!(is_file_answer(file), "{file}");
        }
        for text in [
            "application/json; charset=utf-8",
            "text/html",
            "image/svg+xml",
            "application/vnd.api+json",
            "",
        ] {
            assert!(!is_file_answer(text), "{text}");
        }
    }
}
