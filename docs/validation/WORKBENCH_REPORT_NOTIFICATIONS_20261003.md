<!-- SPDX-License-Identifier: Apache-2.0 -->
# Reports and bottom notifications - 2026-10-03

## Changes

Engineering reports open in a separate resizable native window, with an OS
title bar. Regenerating a report updates and refocuses that window. HTML export
remains handled by the main workspace; the report iframe remains sandboxed.
The browser preview uses a separate popup with the same session bridge.

The header bell and bottom Notifications command open the same collapsible
dock. Model repairs, connector diagnostics, import progress/details, setup
actions, rendering quality and probe/thermal/EM view tools have reserved places
in the bottom dock. App no longer mounts the floating viewport notice corner,
import panel, setup footer or top view-tool overlay. Board net search remains
its existing independently hideable viewer.

Viewport commands use a 32px row, context controls 28px, workspace-only summary
28px, dock tabs 28px and status 24px. The assembly 2D selector uses 26px controls
in a 31px row. Compact command strips retain overflow arrows and keyboard access
without allocating a second row for a scrollbar. Analysis summaries retain
their richer content and a 44px minimum. Notifications selection/expansion is
persisted with workspace state.

## Verification

- Production frontend build and TypeScript: passed.
- Native development executable build with `custom-protocol`: passed.
- Command-strip, workspace, resize-handle and viewport-context checks: passed.
- Viewport-notification tests: passed, including the bell-only/dock modes,
  occurrence-specific model repair, import review and diagnostic actions.
- Board-import, project-snapshot and project-persistence checks: passed.
- Assembly-layout checks: passed with real retained fixture gestures, picking,
  transforms, linked-net mapping and Fit/Focus; copper batching retained exact
  picks while reducing the fixture from 1004 to 5 draw calls.
- Report-runtime checks: passed, including native creation options, child-ready
  snapshots, report updates, restore/show/focus, export, programmatic close,
  OS destruction, stale browser sessions and popup-blocked recovery.
- Architecture and parser checks: passed (32 copper / 35 total layers).
- Help generation and checks: passed using the project Python environment;
  1792 control sites, 354 runtime contexts, 71 CLI pages and 80 diagnostics.
- Rust tests: 35 passed, 1 ignored live OS counter smoke test.
- Browser layout inspected at effective 1920x1226 and 900x620 CSS pixels. At the
  smaller size the Notifications content was below the board viewport; probe
  view controls were inside the dock and no floating probe overlay was mounted.
  Measured compact rows matched the dimensions above. Screenshot:
  `build/workbench-ui-20261003/notifications-900x620.jpg`.

The browser screenshot is an empty-design workbench layout check. The browser
file chooser did not expose the retained assembly to automation, so this check
does not establish board rendering, model completeness or solver validity.
No numerical implementation changed and no solver run is claimed here.

## Remaining native visual check

Native window movement and the actual report child rendering remain unverified.
The computer-use helper previously launched the installed executable instead
of the explicitly selected development path; launching the distinctly named
development copy then timed out awaiting app approval. This limitation is
recorded in `MULTIBOARD_SETUP_WINDOWS_20261003.md`.

With the current build available to the helper, open the retained Arduino UNO
R4/relay-shield fixture, generate a report, move the report outside the main
window, minimize/refocus it and export HTML. Confirm the main 2D/3D assembly
viewport remains visible. At wide and minimum supported sizes, expand/collapse
Notifications and exercise model repair and import retry actions.
