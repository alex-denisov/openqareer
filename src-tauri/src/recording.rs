//! B642: команды записи интервью для экрана C2.
//!
//! `recording_permissions` / `recording_request_permissions` — доступ к микрофону и
//! к записи экрана и системного звука; `recording_start` / `recording_stop` — запись.
//! Состояние уходит событием `recording://state`; в трее во время записи стоит «● Запись».
//! Сегменты отправляются сразу по готовности; после отправки аудио на диске не остаётся.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::recording_upload::{SegmentMeta, Track, UploadTarget, RETRY_DELAYS_MS};

pub const STATE_EVENT: &str = "recording://state";
const TRAY_TITLE: &str = "● Запись";
const TRAY_TOOLTIP: &str = "Идёт запись";
const DRAIN_TIMEOUT: Duration = Duration::from_secs(20);

/// Что сделал писатель дорожки с очередным куском.
#[derive(Debug, Clone)]
pub enum SegmentEvent {
    /// Кусок закрывается; итог придёт позже.
    Closing,
    Written(WrittenSegment),
    Lost,
}

#[derive(Debug, Clone)]
pub struct WrittenSegment {
    pub track: Track,
    pub index: u32,
    pub started_at: String,
    pub duration_ms: u64,
    pub path: PathBuf,
}

pub type SegmentSink = Arc<dyn Fn(SegmentEvent) + Send + Sync>;

#[derive(Default)]
struct Tally {
    pending: AtomicU32,
    segments: AtomicU32,
    failed: AtomicU32,
}

struct Active {
    #[cfg(target_os = "macos")]
    capture: crate::recording_macos::Capture,
    tally: Arc<Tally>,
    uploads: Arc<Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>>,
    ticker: tauri::async_runtime::JoinHandle<()>,
    dir: PathBuf,
}

#[derive(Default)]
pub struct RecordingState {
    active: tokio::sync::Mutex<Option<Active>>,
    screen_asked: AtomicBool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    pub resource_id: String,
    pub upload_url: String,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct Permissions {
    pub supported: bool,
    pub microphone: &'static str,
    pub screen: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub recording_id: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct StopResult {
    pub segments: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StateEvent {
    state: &'static str,
    elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn emit_state(app: &AppHandle, state: &'static str, elapsed_ms: u64, error: Option<String>) {
    let _ = app.emit(
        STATE_EVENT,
        StateEvent {
            state,
            elapsed_ms,
            error,
        },
    );
}

fn show_in_tray(app: &AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id(crate::device_settings::TRAY_ID) {
        #[cfg(target_os = "macos")]
        let _ = tray.set_title(recording.then_some(TRAY_TITLE));
        let _ = tray.set_tooltip(recording.then_some(TRAY_TOOLTIP));
    }
}

/// Номер записи из `…/recordings/<id>/segments`; адрес уже проверен `UploadTarget`.
pub fn recording_id_of(upload_url: &str) -> Option<String> {
    let mut parts = upload_url.rsplit('/');
    let _segments = parts.next()?;
    parts.next().map(str::to_string)
}

/// Принимает итог писателя: считает куски и отправляет готовые.
fn make_sink(
    target: UploadTarget,
    tally: Arc<Tally>,
    uploads: Arc<Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>>,
) -> SegmentSink {
    Arc::new(move |event: SegmentEvent| match event {
        SegmentEvent::Closing => {
            tally.pending.fetch_add(1, Ordering::SeqCst);
        }
        SegmentEvent::Lost => {
            tally.segments.fetch_add(1, Ordering::SeqCst);
            tally.failed.fetch_add(1, Ordering::SeqCst);
            tally.pending.fetch_sub(1, Ordering::SeqCst);
        }
        SegmentEvent::Written(segment) => {
            tally.segments.fetch_add(1, Ordering::SeqCst);
            let target = target.clone();
            let tally_for_upload = tally.clone();
            let handle = tauri::async_runtime::spawn(async move {
                let meta = SegmentMeta {
                    track: segment.track,
                    segment: segment.index,
                    started_at: segment.started_at,
                    duration_ms: segment.duration_ms,
                };
                if !crate::recording_upload::upload_segment(
                    &target,
                    &meta,
                    &segment.path,
                    &RETRY_DELAYS_MS,
                )
                .await
                {
                    tally_for_upload.failed.fetch_add(1, Ordering::SeqCst);
                }
            });
            if let Ok(mut list) = uploads.lock() {
                list.push(handle);
            }
            tally.pending.fetch_sub(1, Ordering::SeqCst);
        }
    })
}

fn access_name(supported: bool, access: Option<&'static str>) -> &'static str {
    if supported {
        access.unwrap_or("denied")
    } else {
        "denied"
    }
}

#[cfg(target_os = "macos")]
fn access_str(access: crate::recording_macos::Access) -> &'static str {
    use crate::recording_macos::Access;
    match access {
        Access::Granted => "granted",
        Access::Denied => "denied",
        Access::Undetermined => "undetermined",
    }
}

fn current_permissions(state: &RecordingState) -> Permissions {
    #[cfg(target_os = "macos")]
    {
        use crate::recording_macos as mac;
        let supported = mac::is_supported();
        let asked = state.screen_asked.load(Ordering::SeqCst);
        Permissions {
            supported,
            microphone: access_name(supported, Some(access_str(mac::microphone_access()))),
            screen: access_name(supported, Some(access_str(mac::screen_access(asked)))),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Permissions {
            supported: false,
            microphone: access_name(false, None),
            screen: access_name(false, None),
        }
    }
}

#[tauri::command]
pub fn recording_permissions(state: State<'_, RecordingState>) -> Permissions {
    current_permissions(&state)
}

#[tauri::command]
pub async fn recording_request_permissions(
    webview: tauri::Webview,
    state: State<'_, RecordingState>,
) -> Result<Permissions, String> {
    require_app_page(&webview)?;
    #[cfg(target_os = "macos")]
    {
        use crate::recording_macos as mac;
        if mac::is_supported() {
            tauri::async_runtime::spawn_blocking(mac::request_microphone)
                .await
                .map_err(|e| e.to_string())?;
            mac::request_screen();
            state.screen_asked.store(true, Ordering::SeqCst);
        }
    }
    Ok(current_permissions(&state))
}

fn recordings_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|base| base.join("recordings"))
        .map_err(|e| format!("cache_dir: {e}"))
}

/// При запуске записи идти не может: всё, что осталось после выхода или сбоя, удаляется.
pub fn purge_leftovers(app: &AppHandle) {
    if let Ok(root) = recordings_root(app) {
        match std::fs::remove_dir_all(&root) {
            Ok(()) => eprintln!("recording: leftover segments removed"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => eprintln!("recording: leftovers not removed: {error}"),
        }
    }
}

/// Папка записи названа локальным UUID: имя на диске не берётся из адреса страницы.
/// Выход из приложения: запись бросается без отправки, все куски удаляются.
pub fn abandon_on_exit(app: &AppHandle) {
    let state = app.state::<RecordingState>();
    let active = state
        .active
        .try_lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(active) = active {
        active.ticker.abort();
        #[cfg(target_os = "macos")]
        crate::recording_macos::abandon(active.capture);
        let _ = std::fs::remove_dir_all(&active.dir);
    }
    purge_leftovers(app);
}

/// Команды записи принимаются только от страницы самого приложения, не от чужого сайта в окне.
pub fn is_app_page(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    match url.scheme() {
        "tauri" => host == "localhost",
        "http" | "https" => {
            host == "tauri.localhost" || (cfg!(debug_assertions) && host == "localhost")
        }
        _ => false,
    }
}

fn require_app_page(webview: &tauri::Webview) -> Result<(), String> {
    match webview.url() {
        Ok(url) if is_app_page(&url) => Ok(()),
        _ => Err("forbidden_origin".to_string()),
    }
}

fn recording_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = recordings_root(app)?.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).map_err(|e| format!("cache_dir: {e}"))?;
    Ok(dir)
}

fn spawn_ticker(app: AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    let started = Instant::now();
    tauri::async_runtime::spawn(async move {
        loop {
            emit_state(
                &app,
                "recording",
                started.elapsed().as_millis() as u64,
                None,
            );
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    })
}

#[tauri::command]
pub async fn recording_start(
    app: AppHandle,
    webview: tauri::Webview,
    state: State<'_, RecordingState>,
    args: StartArgs,
) -> Result<StartResult, String> {
    require_app_page(&webview)?;
    let headers: Vec<(String, String)> = args.headers.into_iter().collect();
    let target = UploadTarget::new(&args.upload_url, &headers)?;
    let recording_id = recording_id_of(&args.upload_url).ok_or("upload_url")?;
    let mut active = state.active.lock().await;
    if active.is_some() {
        return Err("already_recording".to_string());
    }
    let dir = recording_dir(&app)?;
    let tally = Arc::new(Tally::default());
    let uploads = Arc::new(Mutex::new(Vec::new()));
    let sink = make_sink(target, tally.clone(), uploads.clone());
    let capture = start_capture(dir.clone(), sink)
        .await
        .inspect_err(|error| {
            let _ = std::fs::remove_dir_all(&dir);
            emit_state(&app, "error", 0, Some(error.clone()));
        })?;
    eprintln!(
        "recording: started, {} chars of resource id",
        args.resource_id.len()
    );
    *active = Some(Active {
        #[cfg(target_os = "macos")]
        capture,
        tally,
        uploads,
        ticker: spawn_ticker(app.clone()),
        dir,
    });
    #[cfg(not(target_os = "macos"))]
    let _ = capture;
    show_in_tray(&app, true);
    Ok(StartResult { recording_id })
}

#[cfg(target_os = "macos")]
async fn start_capture(
    dir: PathBuf,
    sink: SegmentSink,
) -> Result<crate::recording_macos::Capture, String> {
    use crate::recording_macos as mac;
    if !mac::is_supported() {
        return Err("unsupported".to_string());
    }
    if mac::microphone_access() != mac::Access::Granted {
        return Err("microphone_permission".to_string());
    }
    if mac::screen_access(true) != mac::Access::Granted {
        return Err("screen_permission".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || mac::start(dir, sink))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn start_capture(_dir: PathBuf, _sink: SegmentSink) -> Result<(), String> {
    Err("unsupported".to_string())
}

/// Ждёт, пока писатели закроют последние куски, и дожидается их отправки.
async fn drain(tally: &Tally, uploads: &Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>) {
    let deadline = Instant::now() + DRAIN_TIMEOUT;
    while tally.pending.load(Ordering::SeqCst) > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let handles: Vec<_> = uploads
        .lock()
        .map(|mut list| list.drain(..).collect())
        .unwrap_or_default();
    for handle in handles {
        let _ = handle.await;
    }
}

#[tauri::command]
pub async fn recording_stop(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<StopResult, String> {
    let Some(active) = state.active.lock().await.take() else {
        return Err("not_recording".to_string());
    };
    active.ticker.abort();
    show_in_tray(&app, false);
    emit_state(&app, "uploading", 0, None);
    #[cfg(target_os = "macos")]
    {
        let capture = active.capture;
        let stopped =
            tauri::async_runtime::spawn_blocking(move || crate::recording_macos::stop(capture))
                .await
                .map_err(|e| e.to_string())
                .and_then(|result| result);
        if let Err(error) = stopped {
            eprintln!("recording: stop: {error}");
        }
    }
    drain(&active.tally, &active.uploads).await;
    let _ = std::fs::remove_dir_all(&active.dir);
    emit_state(&app, "idle", 0, None);
    Ok(StopResult {
        segments: active.tally.segments.load(Ordering::SeqCst),
        failed: active.tally.failed.load(Ordering::SeqCst),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_recording_id_comes_from_the_upload_url() {
        assert_eq!(
            recording_id_of("https://openqareer.com/api/v1/candidate/recordings/r-1/segments"),
            Some("r-1".to_string())
        );
    }

    #[test]
    fn only_the_app_page_may_record() {
        for good in [
            "tauri://localhost/app/responses",
            "http://tauri.localhost/app",
        ] {
            assert!(is_app_page(&tauri::Url::parse(good).unwrap()), "{good}");
        }
        for bad in [
            "https://openqareer.com/app",
            "https://hh.ru/",
            "https://tauri.localhost.evil.example/",
            "file:///tmp/x.html",
        ] {
            assert!(!is_app_page(&tauri::Url::parse(bad).unwrap()), "{bad}");
        }
    }

    #[test]
    fn an_unsupported_mac_reports_everything_denied() {
        assert_eq!(access_name(false, Some("granted")), "denied");
        assert_eq!(access_name(true, Some("granted")), "granted");
    }

    #[test]
    fn a_lost_segment_counts_as_failed_and_releases_the_wait() {
        let tally = Arc::new(Tally::default());
        let target = UploadTarget::for_tests("http://127.0.0.1:9/x".into(), vec![]);
        let sink = make_sink(target, tally.clone(), Arc::new(Mutex::new(Vec::new())));
        sink(SegmentEvent::Closing);
        assert_eq!(tally.pending.load(Ordering::SeqCst), 1);
        sink(SegmentEvent::Lost);
        assert_eq!(tally.pending.load(Ordering::SeqCst), 0);
        assert_eq!(tally.segments.load(Ordering::SeqCst), 1);
        assert_eq!(tally.failed.load(Ordering::SeqCst), 1);
    }
}
