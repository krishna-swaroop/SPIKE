<!-- SPDX-License-Identifier: Apache-2.0 -->
# SPIKE WebView and icon checks

Date: 2026-10-03. Main SPIKE's 60 original command glyphs and searchable
Settings > Icon gallery are integrated through the local icon barrel.
The shared frontend guard suppresses browser-default menus and shortcuts;
the Windows host also disables default WebView2 menus, status bar and page zoom.
Main, report and detached windows share this policy. Editor input ownership
prevents application clipboard and undo commands from taking editable events.

## Verified

- Architecture, TypeScript and the production frontend build passed
  (1,951 modules). The updated native Windows debug executable built.
- `npm run test:icons` passed all 60 glyph render/props/accessibility checks
  and eight ribbon workspace vocabulary checks.
- `npm run test:webview` passed event cancellation, retained application
  delivery, developer exception and cleanup checks. The actual App command
  handler passed editor-owned and workspace clipboard/undo/save/open cases.
- `npm run test:studies` passed lifecycle, datasets, capture preflight,
  responsive manager contract and project snapshot cases.
- Full Rust host tests passed: 35 passed, one ignored. These compile the
  Windows WebView2 calls but do not observe a running desktop window.
- The production browser preview showed two radiation search matches and
  eight RF/SI icon cards. Copy/paste stayed in the gallery's search input.
  Right-click showed no browser menu. Earlier checks covered Escape dismissal
  and measured CSS 1100x760 and 1706x960 layouts.

The original local preview screenshot is
`.local/material-ui/spike-icon-pack.png`. This is browser evidence. Native
visual acceptance remains pending after the user stopped earlier native
Computer Use. Browser emulation did not qualify native text undo.

## Full-suite result

The full Python run executed 2,397 tests in 522.094 seconds, with one failure
and 13 skips. The failure is
`test_public_release_readiness.PublicReleaseReadinessTests.test_current_candidate_is_technical_but_externally_blocked`:
the fixture expects `PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`, which the
current candidate metadata does not contain. This UI change did not modify
that fixture or release policy. Full output is retained locally at
`.local/material-ui/spike-main-python-icons-webview.txt`. The suite remains red.

## Reproduction

From `app`, run `npm run build`, `npm run test:icons`, `npm run test:webview`
and `npm run test:studies`. From the root, run
`python scripts/check_architecture.py`,
`python -m unittest discover -s tests/python -v`,
`cargo test --manifest-path app/src-tauri/Cargo.toml` and
`cargo build --manifest-path app/src-tauri/Cargo.toml`.
Relaunch the rebuilt native app for the host settings to apply.
