# Viewport extraction provenance

The standalone engine was extracted on 2026-10-02 from the SPIKE desktop
working tree at commit `edbe9fd01081ee2086f385199587084711d278c3`. The working
tree was intentionally dirty and other work continued while this extraction
was made, so that commit is repository context rather than a claim that the
copied files match its committed versions byte for byte. The standalone source
checked in here is the authoritative portable snapshot.

## Source map

The three presentation owners retain their names in `src/engine/`:

| Standalone file | Desktop source |
| --- | --- |
| `BoardViewport.tsx` | `app/src/BoardViewport.tsx` |
| `LayoutViewport.tsx` | `app/src/LayoutViewport.tsx` |
| `AssemblyLayoutViewport.tsx` | `app/src/AssemblyLayoutViewport.tsx` |

Their relative-import closure was copied from `app/src/` into `src/engine/`.
It contains the existing scene policy, layer/color rules, thermal and result
display helpers, spatial indexes, model loading, resource disposal, procedural
geometry, assembly display, MCAD display contracts, and normalized analysis
result contracts. It deliberately excludes application composition, workers,
Tauri IPC, persistence, filesystem access, and source-format adapters.

`app/src/boardParser.ts` was not copied. `src/engine/boardTypes.ts` contains only
the normalized renderer input types and copper-layer ordering helper that the
scene needs. A host must parse or import its board elsewhere and pass a
`ParsedBoard` to the viewer.

The viewport CSS came from the viewport selectors in `app/src/styles.css`
(principally the original selector blocks around lines 139, 714-722, 894,
976-1021, 1038-1040, and 1104-1112) and
`app/src/AssemblyLayoutViewport.css`. The standalone rules are scoped below
`.spike-viewer` where practical.

## Intentional portable changes

- `board` is the only board-data input. The desktop-only
  `spike-board-imported` global event path is absent.
- `eventTarget` can be supplied on `BoardViewport` for the remaining legacy
  command events: hover preview, model retry, WebGL capture, MCAD gizmo config,
  and MCAD transform preview/commit. Give each viewer its own `EventTarget` to
  contain those messages. Omitting it preserves the old `window` behavior.
  Device pixel ratio, reduced-motion media queries, viewport dimensions, and
  timers still use browser globals; those are environment reads rather than
  cross-view message channels.
- `virtualLayers`, `virtualFrameIndex`, and `onVirtualPick` extend both the SVG
  and Three.js presentation paths. The public wrapper validates each layer's
  board ID and revision before it reaches the engine.
- The Three.js overlay group and all owned geometry, materials, and textures
  are disposed by the same scene cleanup path as existing result overlays.
- Board outlines accept both explicitly closed and open rings. The old renderer
  always removed the final vertex, which cut an open rectangular board into a
  triangle. An area/cutout regression covers the portable correction.

## Coordinates and legacy assembly limit

Virtual data uses source board millimetres. `x` and `y` match `ParsedBoard`;
positive `z` points toward the front/top side and is measured from the board
mid-plane. The single-board SVG maps source points through its layout view-box
projection. Three.js maps a point with the viewport's established transform:

```text
x_world = (x_mm - center_x_mm) * scale
y_world = (center_y_mm - y_mm) * scale
z_world = z_mm * scale
```

Generic virtual layers are rendered only when no assembly occurrence list is
active. They are intentionally suppressed when `virtualBoards` is non-empty,
because v1 layers bind to a board revision and do not yet carry an occurrence
transform. Existing assembly boards, harnesses, result overlays, snap targets,
and MCAD scenes retain their current rendering paths.

Version 0.2 adds `src/assembly/AssemblyViewer.tsx`, a separate composition owner
with right-handed millimetre placement and occurrence-aware virtual-layer
rendering. It reuses extracted board scene builders. The limit above applies
to the inherited `BoardViewport` path, not the new assembly workspace. Optional
source-file adapters now live outside `src` in `adapters/`; see ASSEMBLY.md and
MCAD_IMPORT.md for the new boundary and retained extraction provenance.

## Verification

Run from `standalone/spike_viewer`:

```powershell
npm.cmd run check:boundary
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The boundary check must reject imports from the parent application and native
runtime APIs. The TypeScript check covers the entire extracted closure and the
virtual overlay adapters.
