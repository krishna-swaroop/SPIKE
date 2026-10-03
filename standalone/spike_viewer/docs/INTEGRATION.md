# Independent development and SPIKE integration

This project owns its own package, lockfile, public API, fixtures, behavior
tests, build output, and demo. It can move to a separate Git repository without
changing imports. No sibling checkout or hidden development directory is part
of its runtime.

## Integrate a reviewed release

1. Run `npm run check` here and visually exercise both modes on representative
   normalized boards, including real model assets and multiboard cases when
   touching those paths.
2. Run `npm pack`. Install the resulting tarball into a host React application,
   or publish through the project's chosen release process.
3. Supply a normalized `ParsedBoard` and explicit identity/revision. Convert
   scalar samples with `layerFromScalarSamples`, or construct the versioned
   primitives. Keep worker/file/model conversion services in the host.
4. Migrate SPIKE's viewport call sites incrementally. Preserve current camera,
   selection, net/occurrence identity, units, model availability, result status,
   persistence, resource budgets and diagnostic contracts. Run SPIKE's required
   parser/scene/persistence/native checks for the affected path.
5. Remove duplicated implementation only after parity is demonstrated. Do not
   periodically overwrite standalone edits by recopying the parent source.

The parent SPIKE application currently uses its original files. This extraction
does not silently replace its production renderer or establish full parity for
every inherited analysis/assembly pathway.

## Next development milestones

The engine now has an explicit target of becoming a primary alternative to
KiCad's 3D viewer. [KICAD_VIEWER_TARGET.md](KICAD_VIEWER_TARGET.md) defines the
external-viewer path, the later internal-host path, current gaps and acceptance
gates. Native component-model fidelity and coherent KiCad refresh take priority.

1. Complete native board/model fidelity, then a tested read-only KiCad launcher
   and refresh adapter. Preserve source UUIDs, revisions, model transforms and
   missing-model diagnostics across the single-board and assembly paths.
2. Qualify everyday viewer controls, source selection/cross-probing, rendering
   quality and measured real-board performance against the KiCad target gates.
3. Split scene construction, camera interaction, picking and legacy result
   adapters from inherited composition modules when needed by these milestones,
   preserving behavior with real fixture tests.
4. Extend the new AssemblyViewer occurrence contract with independently bound
   per-occurrence results, persistent mates and assembly export when required.
   Version 0.2 already transforms board-asset virtual layers per occurrence.
5. Add adapters for solver result envelopes, measurements and common field file
   formats. Preserve original units, missing samples and qualification state.
6. Add renderer registration for further display types (volume slices,
   isosurfaces, streamlines, tensors) only with explicit data and display
   semantics, bounds and reference checks.
7. Evaluate a KiCad-hosted rendering integration after external viewer parity;
   retain one independently usable core and keep native lifecycle in the host.

The priorities above are an extension plan, not implemented capability claims.
