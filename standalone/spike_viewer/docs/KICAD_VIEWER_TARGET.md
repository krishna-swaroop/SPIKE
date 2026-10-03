# KiCad 3D viewer replacement target

Direction accepted: 2026-10-03. Baseline: standalone viewer 0.3.0.

The engine should mature into a primary PCB/MCAD visualization workspace that
users can choose instead of KiCad's built-in 3D viewer. The same rendering core
must serve the independent application, SPIKE, and a KiCad integration. This is
a product target with acceptance gates, not a claim that version 0.3 is already
a complete KiCad viewer replacement.

## Deployment and ownership

| Mode | Direction | Current state |
| --- | --- | --- |
| Independent viewer | Develop and test rendering, assemblies and virtual data without running KiCad | Engineering preview available |
| Primary external KiCad viewer | A PCB Editor action opens or refreshes the correct board in this workspace, including its component models | Integration to implement |
| SPIKE embedded viewer | SPIKE consumes a reviewed package release of the same engine | Production migration pending |
| Viewer inside KiCad's own 3D window | Evaluate a KiCad host extension or upstream source integration after external parity | Research; no supported renderer-swap API established |

The initial replacement workflow is a separately launched viewer integrated
with KiCad. The long-term internal-host option remains an explicit target.
KiCad's documented IPC plugins run externally and can register PCB Editor
actions. Its documented 3D plugin class supplies model loading/scene data;
that interface is not evidence of a replaceable rendering backend.
See the official [IPC add-on guide](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-addon-developers/)
and [3D plugin framework](https://dev-docs.kicad.org/en/components/plugins/).

Keep file resolution, IPC, native export, process launching, model conversion,
credential handling and persistence in the host/adapters, outside `src`.
Do not fork the renderer for each application. Keep stable normalized geometry,
model assets, occurrence identity, source revisions, selection and display data
at that boundary. Native OS window management belongs to the desktop host.

## Verified starting point and gaps

| Capability | Version 0.3 evidence | Required for replacement |
| --- | --- | --- |
| Board display | Extracted SVG 2D and Three.js 3D; procedural board rendering and limited KiCad source fixtures | Representative native board geometry and layer parity |
| Component models | Single-board path can consume host-prepared assets; assembly uses proxies and retains model assignment metadata | Authoritative models in both paths, all assignments/transforms, explicit failures |
| KiCad connection | Manual local file import; parent SPIKE legacy launcher is separate | Tested standalone IPC launcher and exact editor/document binding |
| Source identity and refresh | File imports use new asset IDs and source digests | Stable source/object IDs across revisions, coherent refresh and stale-result handling |
| Assemblies and MCAD | Multiple board occurrences, STEP/IGES/GLB/STL/OBJ display imports, movement and one-time snapping | Further constraint/clearance work is separate from viewer parity |
| Results | Board-bound virtual primitives, original samples, frames, provenance and occurrence picks | Maintain this capability during native geometry/model integration |
| Workspace | In-app floating/docked panels, saved layouts and compact drawers | Native detached windows and multiple monitors remain host work |
| Rendering quality | Interactive raster display | Material/lighting controls, image export and qualified render-quality modes |
| Performance | Bounded admission and resource disposal tests | Measured real-board load, interaction, refresh and memory behavior |

The local integration probe found `C:/Program Files/KiCad/10.0/bin/kicad-cli.exe`
version **10.0.6**. Its export help advertises GLB, STEP and VRML, among other
formats. CLI discovery alone does not validate model fidelity or IPC operation.
Sandboxed CLI startup also emitted registry/plugin-directory access errors;
no native viewer launch or plugin session was validated by this probe.

## Ordered milestones

### K1: Native geometry and component-model fidelity

This is the first development priority. Resolve KiCad project-relative paths,
configured variables/model roots and embedded assets in the adapter. Retain
every model assignment, local offset/rotation/scale, footprint placement and
front/back orientation. Support STEP and VRML model workflows with explicitly
tested units. Display native models in both single-board and assembly views;
replace proxies only for models that loaded successfully. Explain missing,
unsupported, stale and failed assets by footprint/model.

Qualify outlines including arcs and cutouts; board thickness/stackup; copper,
zones, mask, paste and silkscreen; drilled holes, slots and plating; component
visibility and population/variant choices. Unsupported geometry remains visible
as a diagnostic. Do not claim all KiCad formats from a successful simple import.

Use original redistributable fixtures covering top/bottom models, multiple
models on one footprint, non-default model transforms, missing models, embedded
assets, custom model roots, slots, cutouts and multilayer boards. Compare
source identity/counts, transformed reference points, dimensions and actual
rendered views against the installed KiCad version. Mesh tolerances must follow
the chosen tessellation settings; a screenshot is not a coordinate oracle.

KiCad's native GLB/STEP export can provide an initial display/reference route,
but verify origin, axes, scale, materials and object identity before use. An
opaque exported mesh must not replace the board's semantic net/object data or
silently acquire source identities by matching names. Export from saved files
must be labelled as saved-file state. KiCad documents embedded model references
and native export behavior in its [PCB Editor manual](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html).

K1 exit: a retained parity suite has no unexplained model placement, board
outline or unit differences; every deliberately unresolved model has an
actionable diagnostic; camera/selection and GPU cleanup regressions pass.

### K2: Launch and refresh from KiCad

Implement a standalone IPC plugin action, initially targeting the installed
KiCad 10 line and probing supported operations/version at connection time.
Bind to the launching editor endpoint and exact document; never guess the
first open board. Keep session credentials out of saved projects and logs.
Start with explicit Open/Refresh and a read-only source relationship.

Capture an immutable scene revision together with its asset manifest. Admit the
new scene completely before replacing the displayed revision. Reject stale
completion from an earlier refresh, support cancellation, retain the last good
scene on failure, and preserve camera, selection and panel arrangement where
the referenced objects still exist. Invalidate or visibly mark result layers
whose board revision no longer matches.

Saved bytes and unsaved editor state are distinct. If the installed IPC cannot
supply a complete coherent live snapshot, expose saved-file refresh as that
specific capability. Do not silently save the user's board or imply live sync.
Refresh/change detection must use supported capabilities; the documented IPC
transport is request/reply, so do not assume push notifications. See the
[IPC implementation guide](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-kicad-developers/).

K2 exit: real launch and refresh tests cover two open boards, unsaved changes,
editor close/restart, a changed model file, failed conversion, cancellation,
and out-of-order completion. Displayed revision and originating editor are
unambiguous throughout. A toolbar icon alone does not pass this gate.

### K3: Everyday viewer parity

Complete source-aware selection and cross-probing where the probed API supports
it, component/layer visibility, DNP/variant handling, standard camera views,
orthographic/perspective navigation, user view presets, configurable materials
and lighting, clipping, measurements, and image export. Preserve keyboard and
small-screen operation with native model diagnostics open. Scope higher-quality
rendering separately and compare it against a documented KiCad reference view.
Do not describe the current raster renderer as raytracing parity.

K3 exit: documented daily inspection tasks can be completed without opening
KiCad's 3D viewer on the qualified corpus. Selection maps by source UUID and
board occurrence, not reference designator alone. Repositioning an assembly
occurrence remains a viewer/MCAD operation; it does not edit the KiCad board.
Any later ECAD write-back needs its own transactions, conflict checks and undo.

### K4: Reliability and performance qualification

Retain small, medium and dense real-board fixtures plus repeated-board/MCAD
assemblies. Record KiCad/viewer versions, hardware, viewport, object/model and
triangle counts, quality settings, cold/warm cache, time to first usable frame,
refresh time, p95 interaction frame time and peak CPU/GPU memory. Set release
budgets from that baseline and report failures rather than hiding geometry.
Exercise repeated open/refresh/close cycles, malformed assets, missing libraries,
resource exhaustion, WebGL loss, cancellation and offline operation.

K4 exit: all K1-K3 gates and documented workload budgets pass on each claimed
platform. Package install/upgrade/uninstall, restart recovery and retained
parity evidence are required before recommending it as the primary viewer.

### K5: KiCad-hosted renderer integration

After K4, prototype the exact KiCad host boundary needed for rendering inside
its own 3D window. Decide with evidence whether this means an upstream extension,
embedding the portable UI, or another maintained native bridge. Record lifecycle,
event loop, graphics ownership, packaging, API compatibility and applicable
dependency obligations before committing to that route. Existing model-loader
plugins and the external IPC launcher do not implement this milestone.

## Scope retained throughout

Multiboard assemblies, MCAD placement, virtual results, 2D/3D consistency and
floating/docked tools remain first-class features. Exact solid/B-rep editing,
persistent mates, collision/clearance solvers, advanced field renderers and
native multi-window hosting have separate correctness requirements; viewer
parity cannot establish those capabilities or validate simulation results.

Follow [INTEGRATION.md](INTEGRATION.md) for the SPIKE package migration and
[VALIDATION.md](VALIDATION.md) for implemented, actually tested capabilities.
