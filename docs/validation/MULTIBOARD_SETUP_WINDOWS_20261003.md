<!-- SPDX-License-Identifier: Apache-2.0 -->
# Separate multiboard setup windows - 2026-10-03

## Behavior

All multiboard workspace entry points open the separate setup window. Desktop
windows have native title bars and resizing; the browser preview uses popups.
The main viewport retains its compact assembly controls. Placement and scoped
Layers/Nets/Links use their existing separate tool windows.

Repeated commands restore and focus an existing window, retaining its session
and draft. Manager commands select the requested tab. Board view commands from
the setup window update the main viewport without closing the setup draft.
MCAD links to the setup window instead of mounting another setup editor.

Native close requests retain the existing draft confirmation. Browser closes
prompt when dirty; parent teardown is reported on actual page exit, so a
cancelled close does not disconnect the draft. Popup opening failures retain
Retry and Close controls. Token checks, stale-revision protection, and main
workspace state authority remain part of the window bridge.

## Checks performed

- `npm run test:assembly-tools`: passed, including existing-window/session
  reuse, browser popup reopening and blocking, native restore/show/focus order,
  native window title/resizing options, parent routing/tab selection, cancelled
  browser close, actual page exit, token rejection and stale revisions.
- `npm run test:assembly-workspace`: passed, including embedded-window rendering,
  dirty draft retention during board view changes, modal navigation protection,
  save gate, diagnostics and board draft operations.
- `npm run test:assembly-board-managers`: passed.
- `npm run test:mcad`: passed; MCAD exposes the setup window entry rather than a
  duplicate board/harness editor.
- TypeScript and frontend production build: passed.
- Help generation/checks, board parser and form contrast: passed.
- Architecture guard and whitespace checks: passed.
- Native development build: passed.
- Rust library tests: 35 passed, 1 ignored live OS counter test.

Frontend production build retains the existing mixed-import and large-chunk
warnings. No numerical solver qualification is established by these UI tests.

## Native visual acceptance pending

The fixture selected for the native check was the existing saved Arduino UNO R4
and relay-shield assembly:
`build/multiboard-workspace-20261003/arduino-r4-relay-demo.spike`.

The computer-use launcher selected the installed SPIKE executable despite an
explicit development path. A distinctly named copy of the current development
binary was prepared in the ignored debug directory, but launching it returned
`Computer Use app approval timed out`. No fixture open, native window movement,
minimize/restore gesture, supported-size screenshot or native persistence check
is claimed as performed for this change.

Once the current build can be selected and approved for computer use, open the
fixture, then **Multi-board**, **Placement**, **Layers**, **Nets** and **Links**.
Move the windows outside the main window, minimize and reopen each, and confirm
that a setup draft and board selection survive. Exercise wide and narrow
supported sizes, and capture both the separate tools and unobscured 2D/3D
assembly viewport. These remain the outstanding visual checks.
