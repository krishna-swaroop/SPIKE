<!-- SPDX-License-Identifier: Apache-2.0 -->
# Assembly workspace v1

`AssemblyViewer` is the portable public viewport. `demo/AssemblyLab.tsx` owns
editing history, imports and project persistence outside the rendering core.
Original SPIKE desktop call sites are unchanged.

```tsx
import { AssemblyViewer, replaceInstance } from "@spike/board-viewer";
import "@spike/board-viewer/style.css";

// document and selectedId are host state; assets have already been imported.
<AssemblyViewer document={document} mode="3D" selectedId={selectedId}
  onSelect={id => setSelectedId(id ?? undefined)}
  tool="translate" space="world" translationSnapMm={1} rotationSnapDeg={15}
  onTransform={(id, matrix, commit) => {
    if (commit) setDocument(old => replaceInstance(old, id, { transform: matrix }));
  }} />
```

Give the viewer a container with explicit height. A host can retain transform
previews separately and put only committed gestures into its undo history;
the standalone lab demonstrates that pattern.

## Data and coordinate contract

An `AssemblyDocument` has schema `spike-viewer/assembly/v1`, millimetre units,
reusable board or mechanical assets, and separately identified occurrences.
An occurrence stores an asset ID, name, rigid transform, visibility, lock and
opacity. Asset and occurrence arrays are immutable inputs: replace arrays and
objects when changing them. Asset admission is cached by array identity during
pointer gestures; mutating an admitted asset array in place is unsupported.

The assembly frame is right-handed XYZ, with Z up. Transform arrays are
row-major, local-to-assembly matrices; translations occupy indices 3, 7 and 11.
Scale, shear and reflection are rejected at the occurrence boundary. File units
are converted by import adapters before assembly admission. Source board
coordinates map once to occurrence-local `[x, -y, z]`: source Y is down, local Y
is up, and source Z toward the board front remains positive. Source origins are
preserved, including boards whose source coordinates are far from zero.

Mechanical meshes use local millimetres. Imported model transforms are baked
by the adapter before placement; retained mesh IDs and face triangle ranges
identify display geometry. Board virtual data stays in source coordinates and
uses the same conversion and occurrence transform as the board. A virtual pick
retains its original sample metadata plus `instanceId`. Equal net names on
different occurrences imply no electrical connection.

The assembly 2D view is an orthographic top projection of the same Three.js
scene, with orbit rotation disabled. Its depth/occlusion follows actual Z;
therefore one board may hide another. Use visibility, isolation, opacity or
placement to inspect stacked parts. It is separate from the single-board SVG
layout viewer.

## Authoring controls

- Import several local files in one transaction. A failed batch preserves the
  existing document. Cancel terminates active STEP/IGES or KiCad workers.
- Select in the occurrence tree or viewport. Move and Rotate attach a gizmo
  to unlocked visible occurrences. Choose world/local axes; zero snap permits
  free movement. Numeric placement uses world millimetres and intrinsic XYZ
  Euler degrees; the stored matrix is authoritative near Euler singularities.
- Duplicate creates another occurrence of the same asset. Hide, opacity, lock,
  isolate, remove and a bounded 20-step undo/redo history support assembly work.
- Fit all/selected, top/front/right/isometric presets, orbit, pan, zoom, edges,
  reference grid and an axis-aligned section plane control presentation.
- Board hole centres and outline-edge midpoints provide source anchors. CAD
  face samples use the first displayed triangle of each retained
  face range. The menu exposes at most 100 anchors per occurrence. Picking can
  supply a surface point elsewhere, or choose **Mesh vertex** to snap to the
  nearest vertex of the picked display triangle. These vertices include
  tessellation points; they are not guaranteed to be original CAD topology
  vertices. Ctrl/Command-click samples a target while
  preserving the moving selection.
- Snap translates a moving anchor onto a target, with an optional gap along
  the target normal. Opposing-normal mode first applies the minimum rotation
  aligning the moving normal opposite the target normal. The twist about that
  normal remains unconstrained. The distance readout reports the actual world
  separation between the two anchors.
- Save/Open stores complete normalized geometry, board virtual data, source
  notes and occurrence properties in portable JSON. A copyable dialog also
  supports environments where the browser download API is unavailable.

Snaps are one-time placement operations. There are no persistent mate graphs,
kinematic constraints, collision checks, interference volumes, solid editing,
B-rep export, or assembly STEP export in this version. Triangulated surface
normals are display approximations, particularly on curved geometry. These
limits must remain explicit when extending the authoring tools.

## Resource and validation boundary

The core checks units, rigid transforms, referenced IDs, geometry arrays,
board/revision bindings and bounded inputs. Maximums are 64 assets, 128
occurrences, 500,000 retained mechanical vertices, 1,000,000 triangles and an
estimated 2,000,000 rendered vertices across occurrences. Board item counts
are capped separately. Project JSON is limited to 64 MiB. Limits are admission
guards, not validated performance promises.

Scenes reuse geometry for selection and placement changes. Replacing assets,
removing occurrences, changing overlay frames and unmounting dispose owned
geometry, materials and textures. Source file URLs are never loaded implicitly.
Section clipping is respected by picking. The public viewport reports invalid
documents before scene creation and reports WebGL failure visibly.

Mechanical face colors share at most 256 materials and 4,096 draw groups per
mesh. Above those budgets a visible diagnostic reports the use of a base-color
fallback; original colors and face triangle ranges remain in the document.

The optional import adapter is separate from the npm rendering-core entry.
Run this source project or integrate its `adapters/` and local runtime copy
script into a host application. Preserve upstream notices and source/rebuild
information when distributing the OCCT runtime.
