# WebView interaction guards

SPIKE installs `app/src/webviewGuards.ts` from the shared React bootstrap, so the main workbench, report preview, assembly tools, and detached result windows use the same browser-default policy.

The guard cancels the native WebView context menu and browser navigation, reload, page-save, print, find, history, source, window, and page-zoom accelerator defaults. It calls only `preventDefault`; it does not stop propagation. Application keyboard ownership runs at document bubbling, followed by the WebView guard at window bubbling, so SPIKE shortcuts execute before the browser default is cancelled. Custom viewport context-menu handlers likewise receive the event before the window guard. Copy, cut, paste, select-all, undo, and redo keyboard commands in editable controls are not claimed by the guard.

Release builds also cancel common inspector accelerators. Development builds explicitly allow inspector accelerators for debugging. Tauri release builds do not enable devtools in this project. Printing remains available through SPIKE's labeled report and Help controls, which call the print API directly.

`node app/scripts/test-webview-guards.mjs` checks the blocked browser keys, retained editing keys, development exception, context-menu cancellation, continued event delivery, and cleanup behavior. `node app/scripts/test-editable-shortcuts.mjs` exercises SPIKE's actual command handler with editor-owned events and workspace events. The shared input ownership helper covers form controls, content-editable surfaces, and embedded Python editors.

The frontend guard is cross-platform and covers dynamically created Tauri windows because they load the same bootstrap. The thin Windows host also disables WebView2's default context menus, browser status bar and page zoom controls in `app/src-tauri/src/webview_policy.rs`. Its application-wide page-load hook applies to main, report and detached tool windows. It uses the existing Tauri platform handle and adds no dependency. Other platforms retain the frontend guard. Host-setting errors are reported on stderr while the frontend guard remains active.

`npm run test:webview` runs both focused suites. Native Windows acceptance still requires checking the rebuilt desktop executable; browser screenshots only establish preview behavior.

See [validation evidence](validation/SPIKE_WEBVIEW_ICON_VALIDATION.md) for the completed builds, observed input behavior and remaining full-suite failure.
