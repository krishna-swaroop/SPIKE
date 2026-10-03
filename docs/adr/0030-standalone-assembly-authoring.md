# ADR 0030: Standalone assembly authoring and optional MCAD imports

Status: Accepted for the standalone engineering preview; desktop integration pending.

Date: 2026-10-02

The independently developed board viewer needs multiple board occurrences,
mechanical file import and assembly placement without SPIKE's native runtime.
Extending the inherited large viewport composition would couple new authoring
behavior to desktop event contracts and retain its generic-overlay limitations.

The standalone project therefore adds an `AssemblyViewer` composition using
React/Three.js and the existing board geometry builder. A normalized document
separates assets from rigidly placed occurrences in a right-handed millimetre
frame. Board-source Y conversion is explicit and applied equally to geometry,
virtual data and picking. The host/demo owns history, source parsing and JSON
persistence. One-time snapping is explicitly distinct from persistent CAD mates
or a solver.

Optional file adapters outside the core import KiCad PCB and mechanical files.
The public OCCT API from pinned `occt-import-js` 0.0.23 provides STEP/IGES
tessellation in a cancellable local worker. Its LGPL notices and source/rebuild
references travel with the separately copied JS/WASM runtime; the rendering
core remains a React/Three library. Original source/fixture provenance is
recorded in the standalone documentation. No third-party implementation source
was copied into SPIKE-owned modules.

Validation includes real STEP size/units, independent KiCad fixtures, transformed
hole/face alignment, source-to-assembly picking, bounds, rejected imports,
resource disposal and JSON round-trips. Assembly viewing does not establish
clearance, electrical connectivity, physical validity or native model fidelity.
No production desktop call site changes as part of this decision.
