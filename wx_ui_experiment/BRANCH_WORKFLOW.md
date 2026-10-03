# wxWidgets and VTK development branch

The local branch is `wxwidgets-vtk`, based on `main`, with local `main`
configured as its upstream. The branch's intended feature set and interaction
behavior match the main SPIKE client. The intentional client changes are
wxWidgets for the interface and VTK for the viewport.

Python workers, solver admission and validation, CAD importers, extensions,
versioned design/result contracts, and `.spike` persistence stay shared with
main. Implement presentation adapters under `wx_ui_experiment/`; avoid forks
of the backend. Keep the Tauri source as the UI reference while native parity
is being completed. `FLOW_PARITY.md` records the remaining acceptance gates.

## Bring changes from main into this branch

First commit or otherwise preserve your intended local work. The checkout had
many pre-existing changes when this branch was created; those were preserved
and are not automatically branch commits.

```powershell
git switch wxwidgets-vtk
git merge main
node wx_ui_experiment/extract_ui.mjs
python wx_ui_experiment/verify_manifest.py
Set-Location wx_ui_experiment
cmake --preset windows-release
cmake --build --preset windows-release
ctest --preset windows-release
```

Run the CMake build/test presets from `wx_ui_experiment/`. Refresh the local
`main` branch through the normal repository workflow when remote changes need
to be included; upstream configuration does not automatically merge changes
or port their UI flows. No scheduled merge, push, or deployment is configured.

For every main UI change, retain command IDs, icon identity, labels, shortcuts,
enabled/busy/error states, and workflow outcomes in the native client. The
manifest verifier detects source drift; a passing inventory check does not
establish functional parity. Recheck project/result interoperability and the
affected backend contracts after merging.

The native client is still under development and is not yet a complete 1:1
replacement. Build outputs, runtime caches, and the older local reference
screenshots stay ignored. Native source, manifest, SVG assets, license notices,
tests, and parity documentation are eligible for branch commits.
