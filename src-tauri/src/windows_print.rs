//! Resume printing and PDF export through WebView2 (B576). The macOS build
//! drives NSPrintOperation on the WKWebView; on Windows the same two commands
//! go to the WebView2 print preview and `PrintToPdf`.

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2PrintSettings, ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows::core::{Interface, HSTRING};

fn main_window(app: &AppHandle, context: &str) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| format!("{context}: main webview unavailable"))
}

/// Opens the WebView2 print preview, which also offers «Save as PDF». The
/// preview reports nothing back, so a shown dialog counts as printed.
pub async fn print_resume(app: &AppHandle) -> Result<bool, String> {
    let window = main_window(app, "print_resume")?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            let shown = (|| -> windows::core::Result<()> {
                // SAFETY: the controller belongs to the live main webview and the
                // calls run on its UI thread inside `with_webview`.
                unsafe {
                    let core: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
                    core.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER)
                }
            })();
            let _ = sender.send(shown.map_err(|error| format!("print_resume: {error}")));
        })
        .map_err(|error| format!("print_resume: {error}"))?;
    receiver
        .await
        .map_err(|_| "print_resume: print preview did not open".to_string())??;
    Ok(true)
}

/// Writes the current page to `path` with WebView2 `PrintToPdf`.
pub async fn save_resume_pdf(app: &AppHandle, path: String) -> Result<bool, String> {
    let window = main_window(app, "save_resume_pdf")?;
    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<bool, String>>();
    window
        .with_webview(move |webview| {
            let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
            let reply = {
                let sender = sender.clone();
                move |result: Result<bool, String>| {
                    if let Some(sender) = sender.lock().ok().and_then(|mut slot| slot.take()) {
                        let _ = sender.send(result);
                    }
                }
            };
            let on_done = reply.clone();
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |status, saved| {
                on_done(
                    status
                        .map(|()| saved)
                        .map_err(|error| format!("save_resume_pdf: {error}")),
                );
                Ok(())
            }));
            let started = (|| -> windows::core::Result<()> {
                // SAFETY: as in `print_resume`; the handler keeps itself alive
                // until WebView2 invokes it.
                unsafe {
                    let core: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
                    core.PrintToPdf(
                        &HSTRING::from(path.as_str()),
                        None::<&ICoreWebView2PrintSettings>,
                        &handler,
                    )
                }
            })();
            if let Err(error) = started {
                reply(Err(format!("save_resume_pdf: {error}")));
            }
        })
        .map_err(|error| format!("save_resume_pdf: {error}"))?;
    receiver
        .await
        .map_err(|_| "save_resume_pdf: PDF operation did not finish".to_string())?
}
