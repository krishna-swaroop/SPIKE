<!-- SPDX-License-Identifier: Apache-2.0 -->
# Assembly rendering and minimized tool dock — 2026-10-03

## Changes

- Minimized Board Nets, PI setup, EM results and floating panels leave the
  drawing surface, including modal backdrops. Their state remains in the owner.
  The bottom shelf restores or closes tools, bounds long labels and supports
  horizontal overflow. Detached windows have persistent bring-forward controls.
- Failed restore/close keeps the retry action and reports the issued
  `SPIKE-FE-APP-E-0001` code. Absent native windows report recovery instead of
  silently claiming focus succeeded.
- Imported board material policy is shared by primary and additional boards;
  opaque laminate writes depth to occlude inner copper. Per-occurrence controls
  do not mutate cached source materials.
- Assembly placements reuse geometry/model loads. Imported opaque fragments are
  merged and repeated detailed parts instanced; exact picking proxies use a
  non-rendered layer. Transparent and unsupported mesh types retain their path.
- Component property dictionaries no longer crash placeholder sizing. Optional
  malformed metadata falls back. Component mount/reference lookup is indexed.
- Optional input containers have stable identities, occurrence complexity is
  counted, placement requests interactive frames and shadows refresh after
  motion settles. Lost WebGL contexts pause and recover rendering.

## Actual GUI observations

The current main React interface was exercised in the Codex browser at CSS
1706 × 960 and 1200 × 800 (75% browser scaling). Board Nets, Layer Manager and
Physical Stackup were minimized simultaneously. Hidden panels had zero-sized
rectangles; the stackup backdrop also had a zero-sized rectangle. The bottom dock
was 28 CSS pixels high at both sizes. Layer Manager restored with its `F.Cu`
search retained. Opening other dialogs left minimized tools hidden.

Captured images are local build evidence:

- `build/viewport-performance-20261003/minimized-tools-wide.jpg`
- `build/viewport-performance-20261003/minimized-tools-narrow.jpg`

The independent scene page used **two occurrences of the real SH-RPi retained
design**, 168 components and four copper layers per board. Source and resolved
KiCad GLBs came from
`build/rpi-hat-acceptance-20261002/cm4io-sailor-hat.spike`, manifest
`f59e3d5bc38b37510682e0bfa599809185807df70a49e0961d36485c40962439`, design
`03e2df50-e351-537e-917d-a600222bc451`.

Both occurrence model stages reported ready with no load error. The scene page
completed 240 translation/rotation updates with its geometry-build counter
remaining 1 and `ready=2;failed=0`. The net viewer minimized into the bottom
shelf and restored to its board scope; a `GND` search returned two of 118 nets.
An enlarged top view showed detailed resolved parts and an opaque board surface.

- `build/viewport-performance-20261003/assembly-model-detail.jpg`
- `build/viewport-performance-20261003/assembly-minimized-tools.jpg`

These are browser observations of production UI/scene components, **not native
SPIKE screenshots or solver results**. Native desktop automation was unavailable
in this session. Native OS minimize/restore still requires live desktop coverage;
the code path and session contracts passed focused checks. The child bridge
currently lacks OS minimized-state reporting, so bring-forward controls remain
present while a child window is open.

## Measured rendering cost

On this local retained two-board scene, batching and camera exclusion of exact
pick proxies reduced renderer geometry buffers from **26,231 to 1,482**, and
draw calls from **3,187 to 1,527**, while retaining **1,501,318 triangles**.
These are observed renderer counters, not geometry simplification or solver
mesh changes. Sampled render CPU time ranged with camera, shadows and concurrent
work; the browser did not establish sustained 60 FPS. Idle drawing is limited
deliberately. Native GPU and full application latency profiling remain necessary.

Backend preparation is measured separately in
[the concurrent visual preparation record](MULTIBOARD_BACKEND_VISUAL_PREPARATION_20261003.md):
28.418 s to 10.753 s for a retained Arduino UNO, with identical artifact sizes.

## Reproduction

After generating the retained Raspberry Pi/HAT acceptance project, capture its
verified assets with the repository Python environment:

```powershell
$env:SPIKE_MODEL_INDEX_PATH = "$PWD/build/assembly-render-index.sqlite"
.venv/Scripts/python.exe scripts/capture_assembly_render_fixture.py build/rpi-hat-acceptance-20261002/cm4io-sailor-hat.spike --design-id 03e2df50-e351-537e-917d-a600222bc451
cd app
npm.cmd run dev -- --host 127.0.0.1
```

Open `/scripts/assembly-performance-preview.html` on the local development
server. The page requires real captured assets and does not synthesize analysis
data. Its portable capture CLI rejects failed stages and absent component scenes.

## Checks and limits

Passed: architecture guard; TypeScript; parser; production build; large scene,
assembly scene/layout, material isolation, component placeholder, thermal input
metadata, model retry, minimized shelf, net viewer, EM viewport manager, detached
tool contracts and offline help checks. Native Cargo tests passed (35, one live
OS counter check ignored).

The full Python run completed 2,396 tests with 13 skips and one existing release
policy failure: `test_current_candidate_is_technical_but_externally_blocked`
expected `PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`. The later structured
snapshot regression and affected backend paths passed a focused 39-test run.
Full output is in `build/viewport-performance-20261003/python-suite.log`.
The release gate was not changed. No numerical solver was modified or qualified
by these viewport checks.
