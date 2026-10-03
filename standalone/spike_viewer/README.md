# SPIKE Board Viewer

An independent TypeScript/React library and local development application for
PCB visualization. It extracts SPIKE's existing Three.js 3D and SVG 2D viewports
and adds board-bound virtual data layers. Version 0.2 adds an independent
assembly workspace and local board/MCAD import. Version 0.3 adds reusable floating
and docked panels, saved layouts and compact screen drawers. This is an
engineering preview.

The product target is a primary alternative to KiCad's built-in 3D viewer,
sharing the same independent core with SPIKE. Native model fidelity, a KiCad
launcher/refresh bridge, everyday viewer parity and real-board qualification
are planned gates; version 0.3 is not yet a complete replacement. See
[the KiCad viewer target](docs/KICAD_VIEWER_TARGET.md).

This folder is self-contained: copy it out or open it as its own project.
Building and running it does not require the parent SPIKE checkout, Python,
Tauri, KiCad, a solver, or a network service. Installing npm dependencies the
first time requires registry access (or an already populated cache).

## Run and develop

Use Node.js 22 or newer and npm. From this folder:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:1432. On Windows use `npm.cmd` if PowerShell blocks npm.ps1.
The default demo opens **Assembly studio**. Import several KiCad boards or
STEP/STP, IGES, GLB, STL and OBJ mechanical models together. Use the occurrence
tree, Move/Rotate gizmos, numeric placement, world/local axes, grid/angle snaps,
hole/edge/surface-point snapping, visibility, locking and isolation to arrange
an assembly. Undo/redo and portable JSON save/open retain the authored geometry
and placements. **Import sample files** exercises two real KiCad source files
and a SPIKE-owned STEP fixture through the actual import adapters.

Drag a panel title or tab to float it, or toward the left, right or bottom edge
to dock it. The placement menu offers the same choices without dragging. Resize
panels and dock dividers, maximize a floating panel, or use **Focus viewport**.
**Panel** reopens a closed panel; **Reset layout** recovers the default arrangement.
Narrow or short workspaces use a panel drawer with the viewport still available.
Both labs remember their layouts separately in this browser. See
[workspace controls and embedding](docs/WORKSPACE.md).

The **Virtual data lab** link opens the original single-board demo. It shows an
original synthetic board, scalar temperature samples, vector
arrows, supplied triangle surfaces, paths, annotations, and multiple frames.
No solver is run. Use the sidebar to show layers and change opacity, the frame
slider to change supplied data, and either viewport to inspect original samples.
Use **Import virtual data** to paste or load JSON; **Export JSON** provides the
complete copyable layer data and a download button.
The demo board binding is `viewer-lab-board`, revision `1`.

```sh
npm run check        # boundary, types, behavior tests, library + demo builds
npm run build        # dist/spike-viewer.js, style.css, TypeScript declarations
npm run build:demo   # static demo-dist; serve it over HTTP
npm run preview:demo # serve the production demo at http://127.0.0.1:1433
npm pack            # installable library tarball
```

## Embed

```tsx
import { BoardViewer, layerFromScalarSamples } from "@spike/board-viewer";
import "@spike/board-viewer/style.css";

const binding = { boardId: "my-board", revision: "design-digest" };
const temperature = layerFromScalarSamples(
  [{ x_mm: 35, y_mm: 40, z_mm: 0.8, value: 62 }],
  { id: "temperature", label: "Measured temperature", binding,
    quantity: "Temperature", unit: "degC", source: "thermocouple-run-7",
    status: "measured" },
);

// normalizedBoard is a ParsedBoard provided by your importer/host.
<div style={{ height: 600 }}>
  <BoardViewer board={normalizedBoard} binding={binding} mode="3D"
    layers={[temperature]} onVirtualPick={sample => console.log(sample)} />
</div>
```

The core library takes normalized geometry. The standalone source project also
ships optional local file adapters in `adapters/`; see [MCAD import](docs/MCAD_IMPORT.md).
They belong to the host boundary and are not included in the core npm entry point.
SPIKE's existing `ParsedBoard` is structurally compatible. Model URLs can refer
to host-prepared GLB/VRML assets, and aligned SVGs can supply source layer views.
Treat geometry and layer arrays as immutable and replace their references when
updating them. Use revision/digest changes to invalidate stale data.

## Ownership

| Location | Responsibility |
| --- | --- |
| `src/engine/` | Extracted board, assembly, selection, camera, resource and result rendering |
| `src/BoardViewer.tsx` | Small public wrapper, data admission and instance isolation |
| `src/overlays/` | Versioned generic layer types, validation, 2D/3D rendering, source picks |
| `src/adapters/spike.ts` | Structural SPIKE scalar-sample adapter; no worker dependency |
| `src/assembly/` | Assembly contracts, placement/snapping, scene, picking and public AssemblyViewer |
| `src/workspace/` | Reusable panel layout, docking, floating, keyboard controls and compact drawers |
| `adapters/` | Optional KiCad/MCAD file conversion and portable assembly JSON |
| `demo/` | Editable development lab and original synthetic fixtures |
| `tests/` | Geometry, metadata, masking, validation, resource-lifetime tests |

See [the overlay contract](docs/VIRTUAL_DATA.md),
[assembly controls and coordinates](docs/ASSEMBLY.md),
[extraction provenance](docs/EXTRACTION.md), and
[integration and development plan](docs/INTEGRATION.md).
Actual checks and remaining verification limits are in [VALIDATION.md](docs/VALIDATION.md).

## Current limits

- `AssemblyViewer` places board-bound layers beneath each board occurrence and
  adds occurrence identity to picks. A reused board asset shares its supplied
  layers across its occurrences. The older advanced `BoardViewport` assembly
  path still suppresses generic layers; use `AssemblyViewer` for the new workflow.
- Generic primitives cover points, arrows, supplied triangular surfaces, paths,
  and text. Volume rendering, isosurfaces, streamlines, tensor glyphs and native
  parametric solid editing are not implemented by this API.
- STEP/IGES input becomes display tessellation. Snapping is a one-time placement
  operation, not a persistent mate, collision or clearance solver. Source STEP
  boundary representations and parametric features are not retained or exported.
- Native KiCad component model paths remain metadata; assembly board rendering
  uses procedural geometry and component proxies. The single-board viewer still
  supports host-prepared model assets.
- 2D projects Z into the board plane; picking preserves original 3D coordinates.
  Color interpolation is display-only and cannot establish physical validity.
- `BoardViewer` isolates its event bus. Advanced `BoardViewport` consumers should
  supply their own `eventTarget`, validate virtual layers, and use the
  `.spike-viewer` CSS wrapper. Low-level renderers expect admitted inputs.
- The inherited viewport composition modules remain large. Incrementally split
  them under characterization tests; avoid rewriting established behavior.
- This extraction is a portable snapshot. SPIKE's production imports have not
  yet migrated to this package; edits do not automatically flow back upstream.
- Floating panels stay inside one workspace. Native OS pop-out windows,
  cross-monitor docking and arbitrary nested split trees are not implemented.

Original SPIKE code is Apache-2.0 unless a file records other terms.
The optional STEP/IGES adapter uses `occt-import-js` / OpenCascade with LGPL
notices; the rendering core continues to use React and Three.js.
See [LICENSE](LICENSE), [NOTICE](NOTICE), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
