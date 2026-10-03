# Verification record - 2026-10-03

## Version 0.3 workspace extension

`npm run check` passed: the 70-module core boundary, TypeScript, 39 behavior
tests, library/declarations and production demo builds. Tests add malformed,
unknown-version and stale-panel layout recovery, float and dock bounds,
edge/corner resizing, close/reopen behavior, storage denial/corruption and
preference round-trips. A camera projection test samples a bounding sphere
against portrait and landscape perspective frusta. The parent architecture
check passed.

Actual browser checks used 1440 x 900, 900 x 700, 390 x 844 and 844 x 390.
Document dimensions stayed within the viewport; tab and launcher strips scroll
locally. Narrow screens now use drawers instead of stacking the inspector
beneath a fixed-height canvas (superseding the 0.1/0.2 layout observations).

- Dragged a floating title, resized its corner, maximized/restored, and dropped
  it onto the right dock. Dragged a dock tab into a float. Plain title/tab
  clicks did not undock. Placement menus and a keyboard dock divider worked.
- Unapplied Z=31/32 placement drafts survived tab changes, docking, closing and
  reopening, viewport focus and compact/desktop transitions. A 527 x 486 float
  returned to its desktop position after a phone-size round trip. Reload
  retained layout geometry; Reset layout recovered the default arrangement.
- Placement menus retained keyboard focus after docking. Compact launchers
  focused panel titles; Escape dismissed the drawer and focused its launcher.
  Short landscape screens kept the scene visible beside a side drawer.
- Production virtual-data 2D picking returned sample 0 at [20,29,1.1] mm and
  26.589 degC for t0; at t2 the compact inspector showed 38.589 degC. Hiding the
  thermal layer removed its selectable samples. Invalid JSON was rejected
  visibly and Escape recovered the workspace. 3D rendered after switching back.
- Production assembly imported two KiCad fixtures and the STEP fixture into
  six occurrences/five assets. Invalid assembly JSON left that scene intact.
  Visibility, 2D/3D, virtual layers and floating display controls worked.
- Corrected assembly perspective fitting to consider horizontal field of view.
  The final production phone check contained the whole selected board. Merely
  resizing still preserves the camera; explicit Fit reframes it.
- Observed production console error/warning logs were empty in both labs.

Runtime screenshots: `docs/evidence/workspace-wide.png`, `workspace-phone.png`
and `workspace-virtual-narrow.png`. These use original SPIKE demo geometry/data.
No new third-party docking code or dependency was added. These are in-workspace
panels, not native OS windows. Native touch devices, cross-monitor operation,
large assembly performance and production SPIKE integration remain unqualified.
The existing OCCT browser externalization and demo bundle-size build warnings
remain; the production STEP worker was exercised successfully.

The packaged library was installed into an isolated consumer with its own
React/Three dependencies, upgraded from 0.2.0 to 0.3.0, and cleanly reinstalled
with `npm ci --offline`. Imports of both viewers and DockWorkspace, workspace
host rendering, shipped CSS and TypeScript declarations passed. Uninstall of
the package from that disposable consumer was verified. The first offline
resolution lacked cached registry metadata; one official-registry install
populated it before the successful offline reinstall. This is not a claim of
fresh-machine offline installation without a dependency cache.

Current deliverables are `artifacts/spike-viewer-0.3.0-source.zip` and
`spike-board-viewer-0.3.0.tgz`. The source project includes import adapters;
the compiled core package continues to omit the optional OCCT runtime.

## Version 0.1 baseline checks

- `npm run check`: portable import boundary across 61 source modules,
  TypeScript, 12 behavior tests, library/declaration build and demo build passed.
- The same source was copied to a separate directory, followed by its own
  `npm ci --offline` against the populated cache and `npm run check`. All passed;
  no parent SPIKE app imports or dependency directory were used.
- Parent `python scripts/check_architecture.py` passed.
- `npm pack` produced an installable library archive.

Behavior checks cover open/closed board area and cutouts, coordinate transforms,
source indices and raycaster picks, null masks, static/multiframe rules, opacity,
physical vector/path geometry, SVG face/segment picks and gesture containment,
label escaping and GPU texture disposal, malformed input, aggregate budgets,
board/revision mismatch, and scalar adapter provenance.

## Browser observations

The local demo was exercised in the Codex browser at 1440 x 900 and 900 x 850.
The smaller layout wraps controls and moves the inspector below the viewer;
the observed document had no horizontal overflow.

- Both SVG 2D and WebGL 3D showed board geometry, components, source cutout,
  colored samples, vectors, paths and labels. Triangle surfaces were enabled
  and inspected in 2D.
- The same thermal sample 0 returned `26.589 degC` at source position
  `[20, 29, 1.1] mm` in both views for frame `t0`.
- Keyboard frame selection changed it to `38.589 degC` for frame `t2`, retaining
  the original coordinates and synthetic provenance.
- Hiding the scalar layer removed its selectable SVG samples.
- A supplied triangle surface returned original sample 4 at `[55,47,5] mm`
  with value `5 V` when its face was picked near that vertex.
- A custom `Strain` / `microstrain` layer imported successfully. A stale
  revision was rejected visibly while existing layers remained intact.
- The export view exposed four complete layers, three thermal frames and the
  original null sample. Escape closed the dialog. JSON round-trip validation
  also passed in automated tests.

Evidence retained in `docs/evidence/viewer-3d.jpg`, `viewer-2d.jpg` and
`viewer-narrow.jpg`. These are actual runtime captures, not generated mockups.

## Limits of this evidence

The browser's download event did not complete for the Blob download button, so
native file-download completion is not confirmed in that embedded browser.
The export dialog provides the full copyable JSON independently of downloads.

For the original 0.1 baseline, no new real-board/native-model, multiboard,
solver, performance qualification or SPIKE production integration run was
performed. The original single-board fixture is synthetic.
The demo bundle emits Vite's size warning (about 1.3 MB uncompressed); this is
not a tested large-board performance claim. No desktop Python/Rust code changed.

## Version 0.2 assembly extension

The complete `npm run check` passed: 66-module core boundary, TypeScript,
29 tests, core library/declarations and production demo. The parent architecture
check also passed. Tests include actual OCCT STEP tessellation with independently
checked 500 x 500 x 5 mm extents, independent KiCad imports, GLB metre/Y-up
conversion and mirrored winding, OBJ units, failure/cancellation, resource
disposal, source/occurrence coordinate picks, clipping, vertex selection,
palette fallback, rigid placement, opposed-normal snapping and project JSON.

The development browser was exercised at 1440 x 960 and 900 x 850, with no
horizontal page overflow in the narrower layout; the inspector moves below
the viewport. Browser observations:

- Imported two KiCad files and a real STEP file in one batch, producing six
  occurrences and five assets including the three original demo occurrences.
- Repeated that batch against the production-built demo on port 1433. Both
  bundled KiCad and separately copied OCCT workers loaded successfully; the
  observed production browser error/warning log was empty.
- Snapped matching board holes to a 12.000 mm normal gap. Undo restored the
  original Z=24 placement and redo restored Z=12.
- Dragged the translation gizmo from Z=12 to Z=24 and confirmed the saved
  transform contained that committed translation. Board virtual samples moved
  with the board.
- Saved JSON, changed placement, rejected an invalid `{}` project without
  changing geometry, then reopened the saved JSON and recovered Z=12.
- Picked the imported STEP top surface at Z=5 mm and created a surface anchor.
  Production vertex mode picked the exact corner `[320,250,5] mm` (including
  the occurrence's +70 mm X translation) and exposed `Picked mesh vertex`.
- Viewed imported geometry in 2D, moved the STEP occurrence and used an X
  section at 70 mm. The section visibly clipped the model.

Retained `docs/evidence/assembly-imported.json` contains the actual normalized
six-occurrence assembly from the browser round-trip, including the imported
STEP display mesh. Capture files include `assembly-imported-2d.jpg`,
`assembly-narrow.jpg` and `assembly-3d.jpg`.

The new code is an assembly-placement engineering preview. Large assemblies,
the full KiCad format, curved CAD snapping accuracy, IGES coverage, persistent
constraints, interference/clearance and native SPIKE integration are not
qualified by these tests. STEP keeps display tessellation, not editable B-rep.
STL/OBJ/GLB loader tests do not establish support for every format extension.
Native OS download completion remains unverified in the embedded browser;
copyable JSON save/open was exercised. No solver result validity is claimed.

Portability was checked by extracting the source into a separate directory,
installing its own lockfile with `npm ci`, and running the complete check there.
All 29 tests and both builds passed without using the parent application or
its dependency directory. The first offline install encountered an uncached
transitive dependency; a subsequent registry-backed install succeeded. This
does not establish that a new machine can install dependencies offline.

Deliverables are `artifacts/spike-viewer-0.2.0-source.zip` (complete independent
source project) and `spike-board-viewer-0.2.0.tgz` (compiled rendering-core npm
package). The source ZIP includes the optional import adapters; the core
tarball intentionally omits the external OCCT browser runtime.

The demo build still reports its approximately 1.38 MB application chunk and
Vite externalization warnings for the Node-only OCCT fallback. The actual
browser import uses the tested local worker runtime; the core npm build does
not ship OCCT binaries. No desktop Python/Rust source changed in this work.
