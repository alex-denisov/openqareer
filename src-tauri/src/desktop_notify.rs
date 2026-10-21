use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, State, Wry,
};

const STATE_FILE: &str = "desktop-notifications.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionStatus {
    Unknown,
    Unverified,
    Denied,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationState {
    pub enabled: bool,
    pub permission_status: PermissionStatus,
    pub enabled_at: Option<String>,
    pub last_poll_at: Option<String>,
    pub seen_ids: Vec<String>,
}

impl Default for DesktopNotificationState {
    fn default() -> Self {
        Self {
            enabled: false,
            permission_status: PermissionStatus::Unknown,
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
) -> Result<(), String> {
    let label = match permission_status {
        PermissionStatus::Denied | PermissionStatus::Unavailable => "Уведомления: недоступны",
        PermissionStatus::Unverified if enabled => "Уведомления: вкл · статус ОС не проверен",
        PermissionStatus::Unverified => "Уведомления: выкл · статус ОС не проверен",
        _ if enabled => "Уведомления: выключить",
        _ => "Уведомления: включить",
    };
    toggle
        .0
        .set_text(label)
        .map_err(|_| "tray_menu_update_failed".to_string())
}

#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main_window_unavailable".to_string())?;
    window
        .show()
        .map_err(|_| "main_window_show_failed".to_string())?;
    window
        .set_focus()
        .map_err(|_| "main_window_focus_failed".to_string())
}

pub fn configure_tray(app: &mut App) -> tauri::Result<()> {
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
        let _ = window.show();
        let _ = window.set_focus();
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
