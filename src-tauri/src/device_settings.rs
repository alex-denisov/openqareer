//! B722: настройки этого устройства из n06 «Приложение» — значок в строке меню и
//! автообновление. Хранятся рядом с приложением, а не у кандидата: на другом
//! компьютере они могут быть другими. Запуск при входе в систему ведёт
//! tauri-plugin-autostart: это состояние самой ОС (LaunchAgent, реестр Windows),
//! дублировать его в файле значит рано или поздно разойтись с ним.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILE: &str = "device-settings.json";
pub const TRAY_ID: &str = "openqareer-tray";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceSettings {
    pub tray_icon: bool,
    pub auto_update: bool,
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            tray_icon: true,
            auto_update: true,
        }
    }
}

/// Изменение из интерфейса: только переданные поля.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceSettingsPatch {
    pub tray_icon: Option<bool>,
    pub auto_update: Option<bool>,
}

impl DeviceSettings {
    pub fn apply(self, patch: DeviceSettingsPatch) -> Self {
        Self {
            tray_icon: patch.tray_icon.unwrap_or(self.tray_icon),
            auto_update: patch.auto_update.unwrap_or(self.auto_update),
        }
    }
}

#[derive(Default)]
pub struct DeviceSettingsState(pub Mutex<DeviceSettings>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE))
        .map_err(|_| "device_settings_unavailable".to_string())
}

/// Нет файла или он испорчен — настройки по умолчанию: значок и автообновление включены.
pub fn read_settings(path: &Path) -> DeviceSettings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_settings(path: &Path, settings: &DeviceSettings) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "device_settings_unavailable".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "device_settings_unavailable".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(settings).map_err(|_| "device_settings_invalid".to_string())?;
    fs::write(&temporary, bytes).map_err(|_| "device_settings_unavailable".to_string())?;
    fs::rename(temporary, path).map_err(|_| "device_settings_unavailable".to_string())
}

fn show_tray_icon(app: &AppHandle, visible: bool) -> Result<(), String> {
    match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray
            .set_visible(visible)
            .map_err(|_| "tray_update_failed".to_string()),
        None => Err("tray_update_failed".to_string()),
    }
}

/// При запуске: читает файл и прячет значок, если кандидат его выключил.
pub fn load_on_startup(app: &AppHandle) {
    let settings = settings_path(app)
        .map(|path| read_settings(&path))
        .unwrap_or_default();
    if let Ok(mut current) = app.state::<DeviceSettingsState>().0.lock() {
        *current = settings;
    }
    if !settings.tray_icon {
        if let Err(reason) = show_tray_icon(app, false) {
            eprintln!("[device-settings] startup tray: {reason}");
        }
    }
}

/// Без значка закрытое окно не вернуть ничем, кроме Dock: на macOS окно прячется
/// (Dock его вернёт), на Windows и Linux — сворачивается на панель задач.
pub fn tray_icon_enabled(app: &AppHandle) -> bool {
    app.state::<DeviceSettingsState>()
        .0
        .lock()
        .map(|settings| settings.tray_icon)
        .unwrap_or(true)
}

#[tauri::command]
pub fn get_device_settings(state: State<'_, DeviceSettingsState>) -> Result<DeviceSettings, String> {
    state
        .0
        .lock()
        .map(|settings| *settings)
        .map_err(|_| "device_settings_unavailable".to_string())
}

#[tauri::command]
pub fn save_device_settings(
    app: AppHandle,
    state: State<'_, DeviceSettingsState>,
    patch: DeviceSettingsPatch,
) -> Result<DeviceSettings, String> {
    let mut current = state
        .0
        .lock()
        .map_err(|_| "device_settings_unavailable".to_string())?;
    let next = current.apply(patch);
    if next.tray_icon != current.tray_icon {
        show_tray_icon(&app, next.tray_icon)?;
    }
    if let Err(reason) = write_settings(&settings_path(&app)?, &next) {
        // Значок уже переключён; без записи он вернётся к прежнему при следующем запуске.
        let _ = show_tray_icon(&app, current.tray_icon);
        return Err(reason);
    }
    *current = next;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_broken_file_means_defaults() {
        let dir = std::env::temp_dir().join(format!("oq-device-settings-{}", std::process::id()));
        let path = dir.join(SETTINGS_FILE);
        assert_eq!(read_settings(&path), DeviceSettings::default());
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, b"{not json").unwrap();
        assert_eq!(read_settings(&path), DeviceSettings::default());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn written_settings_read_back_and_unknown_fields_keep_defaults() {
        let dir = std::env::temp_dir().join(format!("oq-device-settings-rw-{}", std::process::id()));
        let path = dir.join(SETTINGS_FILE);
        let off = DeviceSettings {
            tray_icon: false,
            auto_update: false,
        };
        write_settings(&path, &off).unwrap();
        assert_eq!(read_settings(&path), off);
        fs::write(&path, br#"{"trayIcon":false}"#).unwrap();
        assert_eq!(
            read_settings(&path),
            DeviceSettings {
                tray_icon: false,
                auto_update: true
            }
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn patch_changes_only_given_fields() {
        let base = DeviceSettings::default();
        let next = base.apply(DeviceSettingsPatch {
            tray_icon: Some(false),
            auto_update: None,
        });
        assert_eq!(
            next,
            DeviceSettings {
                tray_icon: false,
                auto_update: true
            }
        );
        assert!(serde_json::from_str::<DeviceSettingsPatch>(r#"{"other":true}"#).is_err());
    }
}
