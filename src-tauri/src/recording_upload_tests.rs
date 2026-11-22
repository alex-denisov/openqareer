use super::*;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[test]
fn upload_url_must_be_the_segments_route_of_openqareer() {
    let id = "0b9c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
    let good = format!("https://openqareer.com/api/v1/candidate/recordings/{id}/segments");
    assert!(validate_upload_url(&good).is_ok());
    for bad in [
        format!("http://openqareer.com/api/v1/candidate/recordings/{id}/segments"),
        format!("https://evil.example/api/v1/candidate/recordings/{id}/segments"),
        format!("https://openqareer.com.evil.example/api/v1/candidate/recordings/{id}/segments"),
        format!("https://openqareer.com/api/v1/candidate/recordings/{id}/finish"),
        "https://openqareer.com/api/v1/candidate/recordings/../segments".to_string(),
        format!("https://user@openqareer.com/api/v1/candidate/recordings/{id}/segments"),
        format!("https://openqareer.com/api/v1/candidate/recordings/{id}/segments?x=1"),
    ] {
        assert!(validate_upload_url(&bad).is_err(), "{bad}");
    }
}

#[test]
fn only_the_recording_token_header_is_passed_on() {
    let headers = vec![
        ("X-Recording-Token".to_string(), "t-1".to_string()),
        ("Cookie".to_string(), "sid=1".to_string()),
        ("Authorization".to_string(), "Bearer x".to_string()),
    ];
    assert_eq!(
        upload_headers(&headers).unwrap(),
        vec![("X-Recording-Token".to_string(), "t-1".to_string())]
    );
    assert!(upload_headers(&[("Cookie".to_string(), "sid=1".to_string())]).is_err());
}

#[test]
fn a_track_is_named_mic_or_system() {
    assert_eq!(Track::Mic.as_str(), "mic");
    assert_eq!(Track::System.as_str(), "system");
}

/// Отвечает по очереди статусами из `statuses`, запоминая тела запросов.
async fn serve(statuses: Vec<u16>) -> (String, Arc<Mutex<Vec<String>>>) {
    serve_with_location(statuses, "http://127.0.0.1:9/elsewhere".to_string()).await
}

async fn serve_with_location(
    statuses: Vec<u16>,
    location: String,
) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "http://{}/api/v1/candidate/recordings/r-1/segments",
        listener.local_addr().unwrap()
    );
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    tokio::spawn(async move {
        for status in statuses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 8192];
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                raw.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&raw).to_string();
                if let Some(head_end) = text.find("\r\n\r\n") {
                    let length = text[..head_end]
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if raw.len() >= head_end + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            log.lock()
                .unwrap()
                .push(String::from_utf8_lossy(&raw).to_string());
            let reply =
                format!("HTTP/1.1 {status} X\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            socket.write_all(reply.as_bytes()).await.unwrap();
        }
    });
    (url, seen)
}

fn segment_file(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("mic-0.m4a");
    std::fs::write(&path, b"AUDIO").unwrap();
    path
}

fn meta() -> SegmentMeta {
    SegmentMeta {
        track: Track::Mic,
        segment: 0,
        started_at: "2026-11-22T09:00:00Z".to_string(),
        duration_ms: 600_000,
    }
}

#[tokio::test]
async fn a_sent_segment_carries_the_fields_and_is_deleted() {
    let (url, seen) = serve(vec![202]).await;
    let dir = tempdir();
    let path = segment_file(&dir);
    let target = UploadTarget::for_tests(url, vec![("X-Recording-Token".into(), "t-1".into())]);
    let sent = upload_segment(&target, &meta(), &path, &[]).await;
    assert!(sent);
    assert!(!path.exists(), "audio stays on disk after 2xx");
    let body = seen.lock().unwrap()[0].clone();
    assert!(body.to_ascii_lowercase().contains("x-recording-token: t-1"));
    for field in [
        "name=\"track\"",
        "mic",
        "name=\"segment\"",
        "name=\"startedAt\"",
        "2026-11-22T09:00:00Z",
        "name=\"durationMs\"",
        "600000",
        "name=\"file\"",
        "audio/mp4",
        "AUDIO",
    ] {
        assert!(body.contains(field), "missing {field}");
    }
}

#[tokio::test]
async fn a_failed_segment_is_retried_and_then_deleted_anyway() {
    let (url, seen) = serve(vec![500, 503, 502]).await;
    let dir = tempdir();
    let path = segment_file(&dir);
    let target = UploadTarget::for_tests(url, vec![("X-Recording-Token".into(), "t-1".into())]);
    let sent = upload_segment(&target, &meta(), &path, &[0, 0, 0]).await;
    assert!(!sent);
    assert_eq!(seen.lock().unwrap().len(), 3);
    assert!(!path.exists(), "audio stays on disk after giving up");
}

#[tokio::test]
async fn a_retry_that_succeeds_counts_as_sent() {
    let (url, _) = serve(vec![500, 202]).await;
    let dir = tempdir();
    let path = segment_file(&dir);
    let target = UploadTarget::for_tests(url, vec![("X-Recording-Token".into(), "t-1".into())]);
    assert!(upload_segment(&target, &meta(), &path, &[0, 0, 0]).await);
    assert!(!path.exists());
}

fn tempdir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("oq-rec-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test]
async fn a_redirect_is_not_followed_and_the_segment_is_dropped() {
    let (elsewhere, other_host) = serve(vec![202]).await;
    let (url, seen) = serve_with_location(vec![302], elsewhere).await;
    let dir = tempdir();
    let path = segment_file(&dir);
    let target = UploadTarget::for_tests(url, vec![("X-Recording-Token".into(), "t-1".into())]);
    assert!(!upload_segment(&target, &meta(), &path, &[0]).await);
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert!(
        other_host.lock().unwrap().is_empty(),
        "audio followed the redirect"
    );
    assert!(!path.exists());
}
