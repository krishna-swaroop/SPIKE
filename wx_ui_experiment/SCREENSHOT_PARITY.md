# Tauri visual reference and wxWidgets parity

The images in `reference_screenshots/` were captured from the installed SPIKE
Tauri desktop window (`spike-desktop.exe`, version shown as 0.2.13) at
1442 × 938 on 2026-09-28. The source of truth for labels and icons remains
`app/src/App.tsx` and `app/src/styles.css`; the installed build now lags the
local source. On 2026-09-30, the source ribbon has 12 tabs (including
Extensions, with EM replacing EMI) and 9 menus (including Extensions). The
captured images document the installed 11-tab/8-menu version and must not be
used as proof that the latest source states have been visually checked.

## Captured states

| Tauri state | Screenshot |
| --- | --- |
| Home ribbon and empty board | `reference_screenshots/00-home.jpg` |
| Mesh | `reference_screenshots/01-mesh.jpg` |
| Solve | `reference_screenshots/02-solve.jpg` |
| PI | `reference_screenshots/03-pi.jpg` |
| HF / SI | `reference_screenshots/04-hf-si.jpg` |
| EMI chamber and setup | `reference_screenshots/05-emi.jpg` |
| Thermal | `reference_screenshots/06-thermal.jpg` |
| Probes | `reference_screenshots/07-probes.jpg` |
| Results | `reference_screenshots/08-results.jpg` |
| Reports | `reference_screenshots/09-reports.jpg` |
| Settings | `reference_screenshots/10-settings.jpg` |
| File, Edit, View, Analysis menus | `reference_screenshots/11-menu-file.jpg` through `14-menu-analysis.jpg` |
| Reports, Project, Tools, Help menus | `reference_screenshots/15-menu-reports.jpg` through `18-menu-help.jpg` |
| Project manager | `reference_screenshots/19-project-manager.jpg` |
| Layer manager dock | `reference_screenshots/20-layer-manager.jpg` |
| Universal search (`Ctrl+K`) | `reference_screenshots/21-universal-search.jpg` |
| Notifications | `reference_screenshots/22-notifications.jpg` |

## Measurements that drive the native shell

- Top application bar: 52 px; application menu: 28 px; tab row: 40 px;
  command ribbon: 82 px. These are client-area measurements, excluding the
  operating-system title bar.
- Primary background colors: `#17232c` top and tabs, `#142029` menu,
  `#1b2a34` ribbon, `#0c151b` board viewport.
- The ribbon has a persistent Board View block on the left, icon-over-label
  command groups with thin separators, and worker state at the right edge.
- Active tabs use amber text and a 2 px amber underline. Active view buttons
  use cyan; unavailable commands are visibly muted.
- Menu popups are approximately 230 px wide, with 29 px rows, icon-leading
  commands, shortcut hints on the right, and a dark blue panel background.
- Home's workspace has a scene navigator, central board viewport, analysis
  setup pane, lower results dock, and 25 px status strip. The EMI state
  replaces the central board surface with its chamber workflow.

## wxWidgets sequence

1. Match the frame chrome, menu popups, 12 current ribbon tabs, Lucide icons,
   persistent Board View controls, and worker state. `src/ui_shell.cpp` now
   draws these using the manifest and the Tauri geometry/colors above.
2. Replace generic native controls in the navigator, viewport toolbar,
   analysis setup, and bottom dock with custom styling and layout verified
   against `00-home.jpg` and each workspace image.
3. Build the large overlays and docks, starting with the project manager,
   layer manager, and universal search shown in screenshots 19–21.
4. Add the remaining command flows, disabled states, errors, and recovery
   behavior. Check each native state against a Tauri screenshot at the same
   window size before calling visual parity complete.

The image set is a reference inventory, not evidence that the current
wxWidgets executable matches it. A compiler and runnable native build are
still required for side-by-side visual verification.
