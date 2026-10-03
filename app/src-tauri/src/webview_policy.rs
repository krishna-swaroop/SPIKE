// SPDX-License-Identifier: Apache-2.0

/// Apply the desktop policy to every WebView, including detached tool windows.
/// The shared frontend bootstrap separately preserves application event routing.
pub fn apply(webview: &tauri::Webview) {
    #[cfg(target_os = "windows")]
    if let Err(error) = webview.with_webview(|platform| {
        // SAFETY: Tauri runs this closure on the WebView's owning UI thread and
        // supplies its live controller. No COM handles escape the closure.
        let configure = || unsafe {
            let settings = platform.controller().CoreWebView2()?.Settings()?;
            settings.SetAreDefaultContextMenusEnabled(false)?;
            settings.SetIsStatusBarEnabled(false)?;
            settings.SetIsZoomControlEnabled(false)
        };
        if let Err(error) = configure() {
            eprintln!("Could not apply native WebView interaction policy: {error}");
        }
    }) {
        eprintln!("Could not schedule native WebView interaction policy: {error}");
    }
    #[cfg(not(target_os = "windows"))]
    let _ = webview;
}
