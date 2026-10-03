# Native UI flow parity and swap gate

Status: static audit of the local wxWidgets experiment against the current
`app/src/App.tsx` on 2026-09-30. This is an ignored local experiment, not a
supported release client. A visible command or a screenshot is not evidence
that the command works or that its solver result is qualified.

## Source of truth and present state

The 2026-09-30 resnapshot captures **12 tabs** (adds `Extensions`, renames `EMI`
to `EM`) and **9 menus** (adds `Extensions`) from the current `App.tsx`.
`verify_manifest.py` now checks source-derived tab/menu order and a digest of
their source regions, so drift fails the static gate until resnapshot. This
checks the static inventory only. Dynamic extension contributions and
state-dependent labels/disabled states still need runtime entries.

The native shell paints chrome and snapshot commands, has split panes, a simple
VTK board preview/camera, a filtered navigator, worker calls for import and
`validate_design`, and a bounded asynchronous JSON-lines bridge. `Dispatch`
handles a small action allowlist; most commands show `ShowPrototypePanel`.
Open/Import/Project manager currently share one file dialog. Native results,
probe table, power tree, console and setup pages are mostly static controls.
No native build or side-by-side interaction check is recorded in `README.md`.

## Acceptance matrix

`Shell` means a label/tab and its broad layout exist. `Partial` means a real
native interaction exists but not the complete Tauri flow. `Missing` means
navigation or prototype notice only. Each row must be exercised with a loaded
board, no board, worker failure, and relevant saved data before a 1:1 claim.

| Workspace in current Tauri | Current functional flow to preserve | Native status and acceptance evidence needed |
| --- | --- | --- |
| Home | Distinct import/open/new/save, project manager, validation/issues, stackup, layers/models/bonds/power tree | **Partial.** Import and validation call worker; open conflates project/import and manager. Add project round-trip, unsaved guard, managers and persisted edits; compare recovered project state. |
| Mesh | PI/SI domain selection, mesh settings, stackup/nets, shared stage and preview | **Shell.** Tab/navigation only; setup notebook is placeholder. Verify request, mesh preview and source-bound diagnostics. |
| Solve | PI/SI setup, run/stop, result and console review | **Shell.** Run shows prototype notice; Stop only cancels bridge request. Verify admitted run, progress, cancellation/restart, errors, result ownership. |
| PI | Direct/series/bulk/batch DC, AC, transient, terminal/path/SPICE setup, results/export | **Missing.** No editable PI setup or solver workflow. Exercise each supported mode with real request/result and explicit unsupported states. |
| HF / SI | Protocol suites, channel tree, impedance, NEXT/FEXT, eye/PAM4, solver choice, ports, Touchstone | **Missing.** Saved ribbon is stale. Verify workflow-specific gating and trace/provenance review. |
| EM | Net/return domain, preflight/risk screen, ports, prepared full-wave case, EMerge, chamber and field review | **Shell only.** The static label now matches `EM`; the native EM flow and result/capability gates remain missing. |
| Thermal | Boundary/material/heat source/airflow setup, optional CFD case, saved temperature review | **Missing.** Notebook hint only. Verify source-bound grids and no inferred field where unsupported. |
| Probes | Hover/place/duplicate, measurement kind, table, compare, CSV | **Shell.** Bottom probe page contains placeholder text; no picks, formulas or export. Verify exact selected source/sample binding. |
| Results | Issues/probes/power tree/console, fields/mesh, limits, revision compare | **Partial navigation.** Four native bottom tabs exist; Issues can show raw validation JSON, other tabs are placeholders. Verify result statuses, fields, topology, comparisons and detach behavior. |
| Reports | Preview/print/PDF, analytics, probe/Touchstone/SPICE export, STEP, result save/load | **Missing.** No report/export handler. Verify artifact content, source/provenance, cancel/error paths. |
| Extensions | Manager, trust, dynamic toolbars/menu contributions, extension results | **Shell only.** Static tab/menu present; add contract-driven contributions, trust/disabled controls and result review. |
| Settings | Preferences, Python, external engines, dependencies, verification, LLM/MCP, libraries, shortcuts, resources/help | **Shell.** Native Settings and Help show prototype notice; latest local automation group absent. Verify persistence, availability and offline/error states. |

### Global surfaces and menus

| Surface | Native status | 1:1 gate |
| --- | --- | --- |
| File, Edit, View, Analysis, Reports, Project, Tools, Extensions, Help menus | Nine current static menus painted; a few View/Analysis/Project actions route | Current entries, shortcuts, dynamic entries, enabled states and each click outcome. No silent aliasing of New/Open/Manager. |
| Board View and central viewport | Nine snapshot buttons painted; 2D/3D/Fit/Top/Iso have camera handlers; simple tracks/pads via VTK | Real layers/models/translucency/bottom camera and object picking; 2D/3D geometry, overlays and limits compared on same design. |
| Left/right/bottom docks | Split visibility and navigator search; generic setup pages and four bottom tabs | Selection inspector, domain-specific setup, Issues/Probe/Power tree/Console data, resize/pin/auto-hide, keyboard and detached tool behavior. |
| Overlays and dialogs | Native file dialog and message boxes only | Project/study managers; unsaved/upgrade/revision dialogs; editable layer/stackup/net/bond/model/assembly managers; PI, SI, EM, thermal, result, report, engine/extension, help/settings/search/notifications flows. |
| Status and notifications | Worker ready/busy text; fixed approximate metric strip | Current project/dirty state, operation progress/cancel, diagnostic severity, resource status, result model status and provenance, missing-model notification. Never display a fixed `Approximate` label as if it describes the active result. |

## Smallest replaceable boundary

Keep Python service, versioned SpiDeR/AssemblyIR, `AnalysisSpec`,
`AnalysisResult`, `.spike` package, and solver capability/status as authority.
The native client should own only presentation and transient interaction state.
First stabilize a typed native adapter around existing worker operations and
project/file contracts: request ID, method/params, bounded response, structured
diagnostics, cancellation/restart, and source/result identity. Do not duplicate
EDA parsing, physics, report derivation, or solver admission in C++.

Make every ribbon/menu/search/shortcut invoke one command ID with explicit
preconditions and one observable outcome. Represent disabled, busy, failed,
cancelled and unsupported states from shared capability data. Persist edits via
the same project authority and re-open them in Tauri as a cross-client check.
Implement loaded design + selection + layer/viewport state first, then PI
setup/run/result/project round-trip; extend the same boundary to SI/EM/thermal
and optional extensions. This keeps the future UI swap at the process/client
boundary instead of creating a second application backend.

## Blocking gates before any swap claim

1. Keep source-derived manifest checks passing; add dynamic extension and
   state-dependent controls to the native runtime before claiming parity.
2. Compile and run the native client on a supported Windows toolchain; compare
   all workspaces and key overlays with Tauri at the same window sizes. The
   screenshots in `SCREENSHOT_PARITY.md` are references only.
3. Prove project/new/open/save/upgrade/unsaved behavior and result round-trip
   across both clients, including worker missing/crash/cancel and malformed
   response recovery.
4. Replace every prototype notice for a claimed feature with a real workflow,
   or expose a clear disabled/unsupported state. Test with actual result bundles
   and verify model status, issues, units and provenance against
   `docs/SOLVER_STATUS.md`; UI parity cannot promote numerical validation.
5. Run focused native contract/UI tests and the project-required architecture
   and integration checks. Production migration also needs a new accepted ADR:
   ADR 0008 is retired and `docs/LANGUAGE_POLICY.md` keeps C++ UI experiments
   outside production roots pending review. Packaging, dependency licenses,
   offline install/upgrade/uninstall and knowledgeable numerical review remain
   release gates where applicable.

Evidence inspected: `app/src/App.tsx` ribbon/menu/overlay composition,
`wx_ui_experiment/src/ui_shell.cpp`, `vtk_canvas.cpp`, `worker_bridge.cpp`,
`ui_manifest.json`, `verify_manifest.py`, `README.md`,
`SCREENSHOT_PARITY.md`, `CONTRIBUTING.md`, `docs/SUBSYSTEM_INDEX.md`,
`docs/SOLVER_STATUS.md`, `docs/LANGUAGE_POLICY.md`, and ADR 0008.
