//! B593: фон и шапка окна (B793) до первого кадра страницы. Тему кандидата страница хранит в
//! localStorage, до загрузки он недоступен, поэтому выбор повторяется в файле рядом
//! с приложением. Файла ещё нет — фон по теме системы.

use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf};
use tauri::{window::Color, AppHandle, Manager, Theme, WebviewWindow, WebviewWindowBuilder};

const MAIN_WINDOW: &str = "main";
const THEME_FILE: &str = "window-theme.json";
/// Те же цвета, что в public/assets/oq-theme-1.js (фон b640/tokens.css).
const LIGHT_BACKGROUND: Color = Color(0xf6, 0xfa, 0xfa, 0xff);
const DARK_BACKGROUND: Color = Color(0x06, 0x0e, 0x0e, 0xff);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowTheme {
    Light,
    Dark,
    System,
}

fn theme_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(THEME_FILE))
        .map_err(|_| "window_theme_unavailable".to_string())
}

fn read_theme(path: &Path) -> Option<WindowTheme> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn write_theme(path: &Path, theme: WindowTheme) -> Result<(), String> {
    let failed = || "window_theme_unavailable".to_string();
    fs::create_dir_all(path.parent().ok_or_else(failed)?).map_err(|_| failed())?;
    let bytes = serde_json::to_vec(&theme).map_err(|_| failed())?;
    fs::write(path, bytes).map_err(|_| failed())
}

fn background(stored: Option<WindowTheme>, system: Theme) -> Color {
    let dark = match stored {
        Some(WindowTheme::Light) => false,
        Some(WindowTheme::Dark) => true,
        Some(WindowTheme::System) | None => system == Theme::Dark,
    };
    if dark {
        DARK_BACKGROUND
    } else {
        LIGHT_BACKGROUND
    }
}

/// Тема шапки окна. `None` снимает прежний выбор: окно и `prefers-color-scheme`
/// страницы снова идут за системой.
fn title_bar(stored: Option<WindowTheme>) -> Option<Theme> {
    match stored {
        Some(WindowTheme::Light) => Some(Theme::Light),
        Some(WindowTheme::Dark) => Some(Theme::Dark),
        Some(WindowTheme::System) | None => None,
    }
}

/// Сначала шапка: после неё `theme()` отвечает темой системы, а не прежним выбором.
fn paint(window: &WebviewWindow, stored: Option<WindowTheme>) -> tauri::Result<()> {
    if let Err(reason) = window.set_theme(title_bar(stored)) {
        eprintln!("[window-theme] title bar: {reason}");
    }
    let system = window.theme().unwrap_or(Theme::Light);
    window.set_background_color(Some(background(stored, system)))
}

/// Главное окно создаётся здесь, а не по tauri.conf.json (`create: false`): оно
/// показывается, когда фон уже выставлен.
pub fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .ok_or(tauri::Error::WindowNotFound)?;
    let window = WebviewWindowBuilder::from_config(app, config)?
        .visible(false)
        .build()?;
    let stored = theme_path(app).ok().and_then(|path| read_theme(&path));
    if let Err(reason) = paint(&window, stored) {
        eprintln!("[window-theme] startup: {reason}");
    }
    window.show()
}

/// Страница сообщает действующий выбор темы: им окно откроется в следующий раз.
#[tauri::command]
pub fn save_window_theme(app: AppHandle, theme: WindowTheme) -> Result<(), String> {
    write_theme(&theme_path(&app)?, theme)?;
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => {
            paint(&window, Some(theme)).map_err(|_| "window_theme_unavailable".to_string())
        }
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_theme_wins_over_the_system_one() {
        assert_eq!(
            background(Some(WindowTheme::Light), Theme::Dark),
            LIGHT_BACKGROUND
        );
        assert_eq!(
            background(Some(WindowTheme::Dark), Theme::Light),
            DARK_BACKGROUND
        );
    }

    #[test]
    fn system_or_unknown_theme_follows_the_system() {
        for stored in [None, Some(WindowTheme::System)] {
            assert_eq!(background(stored, Theme::Light), LIGHT_BACKGROUND);
            assert_eq!(background(stored, Theme::Dark), DARK_BACKGROUND);
        }
    }

    #[test]
    fn title_bar_follows_the_choice_and_lets_the_system_back() {
        assert_eq!(title_bar(Some(WindowTheme::Light)), Some(Theme::Light));
        assert_eq!(title_bar(Some(WindowTheme::Dark)), Some(Theme::Dark));
        assert_eq!(title_bar(Some(WindowTheme::System)), None);
        assert_eq!(title_bar(None), None);
    }

    #[test]
    fn theme_reads_back_and_a_broken_file_is_unknown() {
        let dir = std::env::temp_dir().join(format!("oq-window-theme-{}", std::process::id()));
        let path = dir.join(THEME_FILE);
        assert_eq!(read_theme(&path), None);
        write_theme(&path, WindowTheme::Light).unwrap();
        assert_eq!(read_theme(&path), Some(WindowTheme::Light));
        fs::write(&path, b"\"neon\"").unwrap();
        assert_eq!(read_theme(&path), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
