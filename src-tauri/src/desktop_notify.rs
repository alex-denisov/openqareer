#[cfg(target_os = "macos")]
use block2::{DynBlock, RcBlock};
#[cfg(target_os = "macos")]
use objc2::rc::{Allocated, Retained};
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyObject, ProtocolObject};
#[cfg(target_os = "macos")]
use objc2::{define_class, msg_send, AnyThread, ClassType, DefinedClass};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
#[cfg(target_os = "macos")]
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
#[cfg(target_os = "macos")]
use std::{
    ptr::NonNull,
    sync::{mpsc, OnceLock},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, State, Wry,
};

const STATE_FILE: &str = "desktop-notifications.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopNotificationTarget {
    Opportunities,
    Responses,
    Notifications,
}

impl DesktopNotificationTarget {
    fn as_str(self) -> &'static str {
        match self {
            Self::Opportunities => "opportunities",
            Self::Responses => "responses",
            Self::Notifications => "notifications",
        }
    }
}

fn parse_notification_target(value: &str) -> Option<DesktopNotificationTarget> {
    match value {
        "opportunities" => Some(DesktopNotificationTarget::Opportunities),
        "responses" => Some(DesktopNotificationTarget::Responses),
        "notifications" => Some(DesktopNotificationTarget::Notifications),
        _ => None,
    }
}

fn parse_notification_target_from_user_info(
    user_info: &serde_json::Value,
) -> Option<DesktopNotificationTarget> {
    user_info
        .get("target")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_notification_target)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    Unknown,
    #[serde(alias = "unverified")]
    Granted,
    Denied,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationState {
    pub enabled: bool,
    pub permission_status: PermissionStatus,
    #[serde(default)]
    pub permission_reason: Option<String>,
    pub enabled_at: Option<String>,
    pub last_poll_at: Option<String>,
    pub seen_ids: Vec<String>,
}

impl Default for DesktopNotificationState {
    fn default() -> Self {
        Self {
            enabled: false,
            permission_status: PermissionStatus::Unknown,
            permission_reason: None,
            enabled_at: None,
            last_poll_at: None,
            seen_ids: Vec::new(),
        }
    }
}

pub struct TrayNotificationToggle(pub MenuItem<Wry>);

#[tauri::command]
pub fn get_desktop_notification_state(app: AppHandle) -> Result<DesktopNotificationState, String> {
    read_state(&state_path(&app)?)
}

#[tauri::command]
pub fn save_desktop_notification_state(
    app: AppHandle,
    mut state: DesktopNotificationState,
) -> Result<(), String> {
    if state.seen_ids.len() > 512 {
        state.seen_ids.drain(..state.seen_ids.len() - 512);
    }
    write_state(&state_path(&app)?, &state)
}

#[tauri::command]
pub fn update_desktop_notification_menu_state(
    toggle: State<'_, TrayNotificationToggle>,
    enabled: bool,
    permission_status: PermissionStatus,
    reason: Option<String>,
) -> Result<(), String> {
    toggle
        .0
        .set_text(format_notification_menu_label(
            enabled,
            permission_status,
            reason.as_deref(),
        ))
        .map_err(|_| "tray_menu_update_failed".to_string())
}

#[tauri::command]
pub fn log_desktop_notification_failure(context: String, reason: String) {
    eprintln!(
        "[desktop-notify] {}: {}",
        safe_log_value(&context),
        safe_log_value(&reason)
    );
}

#[tauri::command]
pub async fn get_desktop_notification_permission_state() -> Result<PermissionStatus, String> {
    #[cfg(target_os = "macos")]
    {
        return tokio::task::spawn_blocking(read_macos_permission_status)
            .await
            .map_err(|_| "notification_permission_state_unavailable".to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(PermissionStatus::Granted)
    }
}

#[tauri::command]
pub async fn request_desktop_notification_permission() -> Result<PermissionStatus, String> {
    #[cfg(target_os = "macos")]
    {
        return tokio::task::spawn_blocking(request_macos_notification_permission)
            .await
            .map_err(|_| "notification_permission_request_failed".to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(PermissionStatus::Granted)
    }
}

#[tauri::command]
pub async fn show_desktop_notification(
    app: AppHandle,
    title: String,
    body: String,
    target: String,
) -> Result<(), String> {
    let target = parse_notification_target(&target)
        .ok_or_else(|| "desktop_notification_target_invalid".to_string())?;
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return tokio::task::spawn_blocking(move || show_macos_notification(title, body, target))
            .await
            .map_err(|_| "desktop_notification_show_failed".to_string())?;
    }
    // Windows toasts go through the notification plugin (B576). The plugin has
    // no click callback on desktop, so the toast carries no target screen.
    #[cfg(windows)]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = target;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|_| "desktop_notification_show_failed".to_string())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, title, body, target);
        Err("нативные уведомления недоступны на этой платформе".to_string())
    }
}

#[cfg(target_os = "macos")]
fn show_macos_notification(
    title: String,
    body: String,
    target: DesktopNotificationTarget,
) -> Result<(), String> {
    let content = UNMutableNotificationContent::new();
    let title = NSString::from_str(&title);
    let body = NSString::from_str(&body);
    content.setTitle(&title);
    content.setBody(&body);
    let target_key = NSString::from_str("target");
    let target_value = NSString::from_str(target.as_str());
    let user_info =
        NSDictionary::<NSString, NSString>::from_slices(&[&*target_key], &[&*target_value]);
    unsafe { content.setUserInfo(user_info.cast_unchecked()) };

    let request_id = NSString::from_str(&format!("openqareer-{}", uuid::Uuid::new_v4()));
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&request_id, &content, None);
    add_macos_notification_request(&request)
}

#[cfg(target_os = "macos")]
fn add_macos_notification_request(request: &UNNotificationRequest) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel();
    let callback = RcBlock::new(move |error: *mut NSError| {
        let result = if error.is_null() {
            Ok(())
        } else {
            Err(unsafe { (&*error).localizedDescription().to_string() })
        };
        let _ = sender.send(result);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(request, Some(&callback));
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "notification_request_timeout".to_string())?
}

#[cfg(target_os = "macos")]
fn notification_target_from_user_info(
    user_info: &NSDictionary<AnyObject, AnyObject>,
) -> Option<DesktopNotificationTarget> {
    let key = NSString::from_str("target");
    let target = user_info
        .objectForKey(&key)
        .and_then(|value| value.downcast::<NSString>().ok())?
        .to_string();
    parse_notification_target_from_user_info(&serde_json::json!({ "target": target }))
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct DesktopNotificationDelegateIvars {
    app: OnceLock<AppHandle>,
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = AnyThread]
    #[name = "OpenQareerNotificationDelegate"]
    #[ivars = DesktopNotificationDelegateIvars]
    struct DesktopNotificationDelegate;

    impl DesktopNotificationDelegate {
        #[unsafe(method_id(init))]
        fn init(this: Allocated<Self>) -> Retained<Self> {
            let this = this.set_ivars(DesktopNotificationDelegateIvars::default());
            unsafe { msg_send![super(this), init] }
        }
    }

    unsafe impl NSObjectProtocol for DesktopNotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for DesktopNotificationDelegate {
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive_notification_response(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &DynBlock<dyn Fn()>,
        ) {
            eprintln!("[desktop-notify] notification_clicked");
            let target = response
                .notification()
                .request()
                .content()
                .userInfo();
            if let Some(target) = notification_target_from_user_info(&target) {
                if let Some(app) = self.ivars().app.get().cloned() {
                    schedule_notification_open(app, target);
                }
            }
            completion_handler.call(());
        }

        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present_notification(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,
            ));
        }
    }
);

#[cfg(target_os = "macos")]
static NOTIFICATION_DELEGATE: OnceLock<Retained<DesktopNotificationDelegate>> = OnceLock::new();

#[cfg(target_os = "macos")]
fn install_macos_notification_delegate(app: AppHandle) {
    let delegate = NOTIFICATION_DELEGATE.get_or_init(|| {
        let delegate: Retained<DesktopNotificationDelegate> =
            unsafe { msg_send![DesktopNotificationDelegate::class(), new] };
        let _ = delegate.ivars().app.set(app);
        delegate
    });
    let delegate_protocol: &ProtocolObject<dyn UNUserNotificationCenterDelegate> =
        ProtocolObject::from_ref(&**delegate);
    UNUserNotificationCenter::currentNotificationCenter().setDelegate(Some(delegate_protocol));
}

#[cfg(target_os = "macos")]
fn schedule_notification_open(app: AppHandle, target: DesktopNotificationTarget) {
    let event_app = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Err(reason) = focus_main_window(event_app.clone()) {
            log_native_notification_failure("focus_main_window", &reason);
        }
        if let Err(reason) = event_app.emit("desktop-notify-open", target.as_str()) {
            log_native_notification_failure("emit_notification_open", &reason.to_string());
        }
    }) {
        log_native_notification_failure("dispatch_notification_open", &error.to_string());
    }
}

#[cfg(target_os = "macos")]
fn log_native_notification_failure(context: &str, reason: &str) {
    eprintln!(
        "[desktop-notify] {}: {}",
        safe_log_value(context),
        safe_log_value(reason)
    );
}

#[cfg(target_os = "macos")]
fn read_macos_permission_status() -> Result<PermissionStatus, String> {
    current_macos_authorization_status().map(map_macos_permission_status)
}

#[cfg(target_os = "macos")]
fn request_macos_notification_permission() -> Result<PermissionStatus, String> {
    let current = current_macos_authorization_status()?;
    if current != UNAuthorizationStatus::NotDetermined {
        return Ok(map_macos_permission_status(current));
    }

    let (sender, receiver) = mpsc::channel();
    let callback = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
        let result = if error.is_null() {
            Ok(granted.as_bool())
        } else {
            let description = unsafe { (&*error).localizedDescription().to_string() };
            Err(description)
        };
        let _ = sender.send(result);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &callback,
        );
    receiver
        .recv()
        .map_err(|_| "notification_permission_request_failed".to_string())?
        .map(|granted| {
            if granted {
                PermissionStatus::Granted
            } else {
                PermissionStatus::Denied
            }
        })
}

#[cfg(target_os = "macos")]
fn current_macos_authorization_status() -> Result<UNAuthorizationStatus, String> {
    let (sender, receiver) = mpsc::channel();
    let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref().authorizationStatus() };
        let _ = sender.send(status);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&callback);
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "notification_permission_state_timeout".to_string())
}

#[cfg(target_os = "macos")]
fn map_macos_permission_status(status: UNAuthorizationStatus) -> PermissionStatus {
    match status {
        UNAuthorizationStatus::NotDetermined => PermissionStatus::Unknown,
        UNAuthorizationStatus::Denied => PermissionStatus::Denied,
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => PermissionStatus::Granted,
        _ => PermissionStatus::Unavailable,
    }
}

fn format_notification_menu_label(
    enabled: bool,
    permission_status: PermissionStatus,
    reason: Option<&str>,
) -> String {
    match permission_status {
        PermissionStatus::Denied => "Уведомления: запрещены в настройках macOS".to_string(),
        PermissionStatus::Unavailable => format!(
            "Уведомления: недоступны — {}",
            reason
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("сбой службы уведомлений")
        ),
        PermissionStatus::Granted | PermissionStatus::Unknown if enabled => {
            "Уведомления: выключить".to_string()
        }
        PermissionStatus::Granted | PermissionStatus::Unknown => {
            "Уведомления: включить".to_string()
        }
    }
}

fn safe_log_value(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(180)
        .collect()
}

#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main_window_unavailable".to_string())?;
    bring_window_to_front(&app, &window)
}

// AppHandle::show() на macOS делает только unhide; активируем приложение явно.
#[cfg(target_os = "macos")]
fn activate_macos_app(app: &AppHandle) -> Result<(), String> {
    let _ = app.show();
    match objc2::MainThreadMarker::new() {
        Some(mtm) => activate_shared_app(mtm),
        None => app
            .run_on_main_thread(|| {
                if let Some(mtm) = objc2::MainThreadMarker::new() {
                    activate_shared_app(mtm);
                }
            })
            .map_err(|_| "app_activate_dispatch_failed".to_string())?,
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn activate_shared_app(mtm: objc2::MainThreadMarker) {
    let ns_app = objc2_app_kit::NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    ns_app.activateIgnoringOtherApps(true);
}

// На macOS show()+set_focus() не поднимают окно, пока активно другое приложение
// (клик в строке меню или по уведомлению), поэтому сначала активируем приложение.
fn bring_window_to_front(app: &AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    activate_macos_app(app)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    let _ = window.unminimize();
    window
        .show()
        .map_err(|_| "main_window_show_failed".to_string())?;
    window
        .set_focus()
        .map_err(|_| "main_window_focus_failed".to_string())
}

pub fn configure_tray(app: &mut App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    install_macos_notification_delegate(app.handle().clone());

    let open = MenuItem::with_id(app, "open_app", "Открыть openqareer", true, None::<&str>)?;
    let toggle = MenuItem::with_id(
        app,
        "toggle_notifications",
        "Уведомления: включить",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit_app", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &toggle, &quit])?;
    let _ = app.manage(TrayNotificationToggle(toggle));

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default app icon is configured");
    TrayIconBuilder::with_id("openqareer-tray")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_app" => show_main_window(app),
            "toggle_notifications" => {
                let _ = app.emit("desktop-notify-toggle-request", ());
            }
            "quit_app" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(reason) = bring_window_to_front(app, &window) {
            eprintln!("[desktop-notify] show_main_window: {reason}");
        }
    }
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(STATE_FILE))
        .map_err(|_| "desktop_notification_state_unavailable".to_string())
}

fn read_state(path: &PathBuf) -> Result<DesktopNotificationState, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "desktop_notification_state_invalid".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(DesktopNotificationState::default())
        }
        Err(_) => Err("desktop_notification_state_unavailable".to_string()),
    }
}

fn write_state(path: &PathBuf, state: &DesktopNotificationState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "desktop_notification_state_unavailable".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "desktop_notification_state_unavailable".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let bytes =
        serde_json::to_vec(state).map_err(|_| "desktop_notification_state_invalid".to_string())?;
    fs::write(&temporary, bytes)
        .map_err(|_| "desktop_notification_state_unavailable".to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "desktop_notification_state_unavailable".to_string())?;
    }
    fs::rename(temporary, path).map_err(|_| "desktop_notification_state_unavailable".to_string())
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::map_macos_permission_status;
    use super::{
        format_notification_menu_label, parse_notification_target,
        parse_notification_target_from_user_info, DesktopNotificationTarget, PermissionStatus,
    };

    #[test]
    fn formats_each_notification_menu_state() {
        assert_eq!(
            format_notification_menu_label(false, PermissionStatus::Unknown, None),
            "Уведомления: включить"
        );
        assert_eq!(
            format_notification_menu_label(true, PermissionStatus::Granted, None),
            "Уведомления: выключить"
        );
        assert_eq!(
            format_notification_menu_label(false, PermissionStatus::Denied, None),
            "Уведомления: запрещены в настройках macOS"
        );
        assert_eq!(
            format_notification_menu_label(
                false,
                PermissionStatus::Unavailable,
                Some("ошибка IPC")
            ),
            "Уведомления: недоступны — ошибка IPC"
        );
    }

    #[test]
    fn parses_only_whitelisted_targets_from_notification_user_info() {
        assert_eq!(
            parse_notification_target_from_user_info(&serde_json::json!({
                "target": "opportunities"
            })),
            Some(DesktopNotificationTarget::Opportunities)
        );
        assert_eq!(
            parse_notification_target_from_user_info(&serde_json::json!({ "target": "responses" })),
            Some(DesktopNotificationTarget::Responses)
        );
        assert_eq!(
            parse_notification_target_from_user_info(&serde_json::json!({
                "target": "notifications"
            })),
            Some(DesktopNotificationTarget::Notifications)
        );
        assert_eq!(
            parse_notification_target_from_user_info(&serde_json::json!({ "target": "private" })),
            None
        );
        assert_eq!(
            parse_notification_target_from_user_info(&serde_json::json!({ "other": "responses" })),
            None
        );
        assert_eq!(
            parse_notification_target_from_user_info(&serde_json::json!({ "target": 42 })),
            None
        );
        assert_eq!(parse_notification_target("unknown"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn maps_native_macos_permission_status_without_trusting_the_plugin_default() {
        use objc2_user_notifications::UNAuthorizationStatus;

        assert_eq!(
            map_macos_permission_status(UNAuthorizationStatus::NotDetermined),
            PermissionStatus::Unknown
        );
        assert_eq!(
            map_macos_permission_status(UNAuthorizationStatus::Denied),
            PermissionStatus::Denied
        );
        assert_eq!(
            map_macos_permission_status(UNAuthorizationStatus::Authorized),
            PermissionStatus::Granted
        );
    }
}
