# SPIKE wxWidgets / VTK UI replica experiment

This is a new local prototype of the active Tauri interface. The earlier
`wx_desktop/` experiment was removed. Development now uses the local branch
`wxwidgets-vtk`, tracking `main`. Source and assets are eligible for Git
tracking; build outputs and older local screenshots remain ignored. Nothing
has been pushed. See `BRANCH_WORKFLOW.md` for synchronization and parity gates.

## Visual source of truth

`extract_ui.mjs` snapshots the current `app/src/App.tsx` ribbon and menu labels
to `ui_manifest.json`. It also renders the same Lucide React icons to SVG and
copies the SPIKE mark into `assets/`. The native chrome is painted to match
`app/src/styles.css`: 52 px top bar, 28 px menu, 40 px ribbon tabs, 82 px
command band, 224/272 px default side panels, 178 px bottom dock, dark flat
surfaces, amber selection, cyan view toggles, and the same grouped icon-above-
label ribbon buttons. Changes to the active ribbon can be resnapshotted with:

```powershell
cd wx_ui_experiment
node extract_ui.mjs
```

The header, menu row, all current tabs, persistent nine-icon Board View group,
and every ribbon command are populated from this snapshot. Menu and ribbon
clicks navigate the native shell. The menu dropdowns are custom drawn rather
than Windows menu chrome. SVG icons are generated from the repository's pinned
`lucide-react` 0.468.0 dependency under its ISC license; see
`assets/NOTICE.txt`.

Installed Tauri desktop screenshots of its tabs and application menus, plus
project manager, layer manager, search, and notifications, are stored in
`reference_screenshots/`. See `SCREENSHOT_PARITY.md` for the capture inventory,
measured shell geometry, and the native implementation sequence. The installed
build is older than the latest local ribbon/menu source; the extractor and
verifier now compare against that source to flag drift.

## Native architecture

- `src/ui_shell.cpp`: custom wxWidgets top chrome and menu, split-pane
  workspace, contextual setup pages, bottom Results/Console dock.
- `src/vtk_canvas.cpp`: VTK on a wx-owned OpenGL canvas, bounded explicit
  SpiDeR v1/v2 tracks/pads/vias/outlines, layers, and camera navigation.
- `src/worker_bridge.cpp`: asynchronous bounded JSON-lines process bridge.
  Board import and design validation call the existing SPIKE Python worker.
  The UI does not link solver kernels or parse KiCad data.

## Build and launch

On Windows with a C++ compiler, CMake, vcpkg, wxWidgets, and VTK:

```powershell
cd wx_ui_experiment
cmake --preset windows-release
cmake --build --preset windows-release
.\build\windows-release\Release\spike-wx-ui-experiment.exe
```

Launch from this directory or the repository root so the prototype can find
its resources and the SPIKE worker. It prefers `.venv/Scripts/python.exe` in the
repository, then system Python. The vcpkg overlay is self-contained under
`wx_ui_experiment/vcpkg-ports` and has no dependency on the removed client.

## Parity status

The shell, visual language, menu and ribbon hierarchy are implemented as a
first pass. Project/design opening through the worker, simple VTK board
display, camera controls, and design validation have native handlers. Other
commands currently show an explicit prototype notice. In particular the
floating PI setup, editable layer/stackup managers, full SI/EMI/thermal
workbenches, probes, result visualizer, reports, extensions, and preferences
still need native implementations before this can be called a 1:1 functional
replica. Solver model status and capability gating must stay authoritative.

The native client has compiled with MSVC and launched on Windows. Native
project-session and worker-recovery tests passed. Project package round trips
also passed in the project's Python environment. The most recent styling
changes still need a combined rebuild and visual verification; full native
workflow parity remains incomplete.
