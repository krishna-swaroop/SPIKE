# Chart, flex and local EMerge update validation

Date: 2026-10-04. Applies to SPIKE and sibling SPIKE-Em.

## Delivered behavior

- Live quantitative charts share pointer-anchored wheel zoom, individual-axis
  hit testing and explicit axis locks. Cartesian subplots, log/date/reversed
  axes, polar radius/angle and 3D camera/axis ranges have focused checks.
  Source arrays, units, null gaps, sample selection and qualification stay
  owned by their domain adapters. Offline HTML report curves also support
  wheel/axis zoom; static illustrations and PNG/PDF exports remain static.
- The Flex PCB manager is reachable from View, the FLEX/RIGID-FLEX badge and
  the board navigator. It displays imported regions, bend angles/radii/spans,
  source-layer provenance and global/bend diagnostics. Definition JSON exports
  and copied KiKakuka annotations preserve original coordinates and text.
  Native KiCad source remains the editing authority.
- EMerge setup includes local update checks, stable/prerelease selection,
  exact-version installation, persistent workspace tracking and logs. Updates
  run in a dedicated solver virtual environment, exclude EMerge/Optycal
  operations sharing it, and verify installed version, dependencies and APIs.
  EMerge 3+ probing distinguishes executed fixture evidence from future-version
  API detection; neither establishes numerical validation.

## Automated and CLI evidence

Passed in both projects:

- Architecture, frontend TypeScript and production builds.
- Parser and normalized-board checks; seven Python flex-format tests.
- Wheel range helpers, actual production wheel event handlers, offline SVG
  transforms/clipping/print restoration, clipboard unit/gap checks.
- RF chart adapters, linked EM viewport graphs, EMerge network review,
  SI workflow/channel plots, thermal chart and AC plot/report focused checks.
- Flex manager annotation, missing/invalid parameter, source preservation,
  global diagnostics, empty state and rendered table checks.
- Update controller stale-response protection, target pinning, duplicate
  prevention, lost-status recovery and rendered pending/failure states.
- Nineteen updater backend tests, plus relevant Optycal/STEP checks: 29 tests
  run per project with zero failures and three optional integration skips.
- Shared button/control standard and webview guard checks.

KiCad CLI 10.0.6 accepted a disposable independently authored FreekiCAD board
and exported its selected layers to SVG. SPIKE parsed the same source to one
90-degree bend with a 0.5 mm radius. See [format evidence](../KIKAKUKA_FLEX_FORMAT.md).

Actual read-only worker update checks against official PyPI metadata found
installed EMerge 3.0.0a19 and offered 3.0.0a20. Main SPIKE auto-resolved its
`.venv-emerge3`. SPIKE-Em passed using that interpreter explicitly; its own
distribution root has no dedicated solver virtual environment. Automatic
selection correctly reported that absence. No packages were installed.

## Required suite outcomes

| Gate | SPIKE | SPIKE-Em |
| --- | --- | --- |
| Full Python | 2,445 tests, one failure, 13 skipped | 2,397 tests, 47 failures, 36 errors, 71 skipped |
| Rust host | 38 passed, one ignored | 34 passed, one failure, one ignored |

Main Python's failure is
`test_current_candidate_is_technical_but_externally_blocked`: the expected
`PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED` issue is absent. It also failed
before this work. SPIKE-Em's 83 failure/error identities exactly match its
previous closing-suite log. Its Rust failure remains the missing packaged
`resources/worker/spike-worker/spike-worker.exe` fixture in
`resident_packaged_worker_preserves_a_native_spikes_session`. These gates are
not reported as passing.

The full Python runs included the updater's initial 17 tests. The final
Optycal shared-runtime guard extended that focused suite to 19 tests afterward;
all 29 updater/Optycal/STEP tests were rerun on that final source. Full-suite
results above are retained as that earlier snapshot, not as a green release.

Main logs are under `.local/plot-wheel/`; standalone full-suite/build logs are
under `docs/validation/SPIKE_EM_CHART_FLEX_*`. Builds emit the existing large
bundle warning; static manager rendering emits React's expected useLayoutEffect
SSR warning. Neither is evidence of native visual acceptance.

## Acceptance limits

The supported browser UI tool rejected access to the existing preview tab
under its URL policy. No alternate automation surface was used. Native UI
wide/narrow-window visual acceptance and screenshots remain unverified.
Native SPIKE, FreeCAD and package installation were not launched in this work.

Flex support is import, inspection, annotation copy, export and source/project
persistence. Folded solids, KiKakuka stiffener annotations, component bending
transforms and a bent-board RF mesh/solve are outside this implementation.
The viewport and solver reference geometry remain flat.

The updater requires an existing separate virtual environment with pip; it
does not provision one or roll back failed installations. Forced worker
termination can orphan pip and lose operation status. Lost status remains
unresolved until the installer is known to have stopped; recovery and runtime
licensing boundaries are documented in [the update workflow](../EMERGE_RUNTIME_UPDATES.md).
