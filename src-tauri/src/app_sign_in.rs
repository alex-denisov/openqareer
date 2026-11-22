//! B755: вход в приложение через браузер.
//!
//! Приложение открывает в браузере по умолчанию страницу `/app-sign-in` сайта и ждёт возврата
//! по своей схеме: `openqareer://signed-in` у сборки для openqareer.com, `openqareer-dev://` у
//! отладочной — чтобы две сборки на одном Mac не перехватывали код друг у друга. Код из адреса
//! окно обменивает на сессию вместе с verifier, который наружу не уходит.

use tauri::{AppHandle, Emitter};

/// Схема, которую эта сборка регистрирует в Info.plist и принимает.
pub const CALLBACK_SCHEME: &str = if cfg!(debug_assertions) {
    "openqareer-dev"
} else {
    "openqareer"
};
/// Событие окна с адресом возврата; то же имя в `desktopBrowserSignIn.ts`.
const SIGN_IN_EVENT: &str = "openqareer://sign-in-callback";
const PRODUCTION_SITE: &str = "https://openqareer.com";
const SIGN_IN_PATH: &str = "/app-sign-in";
const CALLBACK_MAX_LEN: usize = 512;

fn is_token(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Сайт для входа: прод, а в отладочной сборке ещё локальный сайт.
fn allowed_site(site: &str) -> bool {
    site == PRODUCTION_SITE
        || (cfg!(debug_assertions)
            && (site == "http://localhost:3000" || site == "http://127.0.0.1:3000"))
}

/// Адрес страницы входа из проверенных частей; кроме challenge и state в адрес ничего не попадает.
pub fn sign_in_url(site: &str, challenge: &str, state: &str) -> Result<String, String> {
    if !allowed_site(site) {
        return Err("app_sign_in_site_not_allowed".into());
    }
    if !is_token(challenge, 43, 43) || !is_token(state, 16, 64) {
        return Err("app_sign_in_invalid_request".into());
    }
    let client = if cfg!(debug_assertions) {
        "&client=dev"
    } else {
        ""
    };
    Ok(format!(
        "{site}{SIGN_IN_PATH}?challenge={challenge}&state={state}{client}"
    ))
}

/// Адрес возврата принимается только своей схемы и с постоянным путём.
pub fn accept_callback(url: &str) -> Option<&str> {
    let prefix = format!("{CALLBACK_SCHEME}://signed-in?");
    (url.starts_with(&prefix) && url.len() <= CALLBACK_MAX_LEN).then_some(url)
}

/// Открывает страницу входа в браузере по умолчанию.
#[tauri::command]
pub fn desktop_open_sign_in(
    app: AppHandle,
    webview: tauri::Webview,
    site: String,
    challenge: String,
    state: String,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("forbidden_caller".into());
    }
    let url = sign_in_url(&site, &challenge, &state)?;
    #[allow(deprecated)]
    tauri_plugin_shell::ShellExt::shell(&app)
        .open(url, None)
        .map_err(|error| format!("app_sign_in_open: {error}"))
}

/// Адрес, который macOS передал приложению: свой возврат — в главное окно, окно — вперёд.
pub fn deliver_opened_urls<'a>(app: &AppHandle, urls: impl IntoIterator<Item = &'a str>) {
    for url in urls.into_iter().filter_map(accept_callback) {
        // Только главному окну: окна площадок с чужими страницами адрес с кодом не получают.
        match app.emit_to("main", SIGN_IN_EVENT, url) {
            // Сам адрес с кодом в журнал не пишем.
            Ok(()) if cfg!(debug_assertions) => eprintln!("[app-sign-in] callback delivered"),
            Ok(()) => {}
            Err(reason) => eprintln!("[app-sign-in] deliver: {reason}"),
        }
        crate::desktop_notify::show_main_window(app);
    }
}

#[cfg(test)]
mod tests {
    use super::{accept_callback, sign_in_url, CALLBACK_SCHEME};

    const CHALLENGE: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    const STATE: &str = "state-0123456789ab";

    #[test]
    fn opens_only_the_sign_in_page_of_the_site() {
        let url = sign_in_url("https://openqareer.com", CHALLENGE, STATE).unwrap();
        assert!(url.starts_with(&format!(
            "https://openqareer.com/app-sign-in?challenge={CHALLENGE}&state={STATE}"
        )));
        assert_eq!(url.ends_with("&client=dev"), cfg!(debug_assertions));
        assert!(sign_in_url("https://evil.example", CHALLENGE, STATE).is_err());
        assert!(sign_in_url("https://openqareer.com.evil.example", CHALLENGE, STATE).is_err());
    }

    #[test]
    fn takes_no_foreign_characters() {
        assert!(sign_in_url("https://openqareer.com", "short", STATE).is_err());
        let injected = format!("{}&x=1", &CHALLENGE[..39]);
        assert!(sign_in_url("https://openqareer.com", &injected, STATE).is_err());
        assert!(sign_in_url("https://openqareer.com", CHALLENGE, "s#").is_err());
    }

    #[test]
    fn accepts_only_its_own_scheme_and_path() {
        let own = format!("{CALLBACK_SCHEME}://signed-in?code=oqa_x&state=s");
        assert_eq!(accept_callback(&own), Some(own.as_str()));
        let other = if CALLBACK_SCHEME == "openqareer" {
            "openqareer-dev://signed-in?code=oqa_x"
        } else {
            "openqareer://signed-in?code=oqa_x"
        };
        assert_eq!(accept_callback(other), None);
        assert_eq!(
            accept_callback(&format!("{CALLBACK_SCHEME}://other?code=x")),
            None
        );
        assert_eq!(accept_callback("https://openqareer.com/?code=x"), None);
        let long = format!("{own}{}", "a".repeat(600));
        assert_eq!(accept_callback(&long), None);
    }
}
