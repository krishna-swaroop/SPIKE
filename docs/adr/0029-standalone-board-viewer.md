# ADR 0029: Independent board visualization project

Date: 2026-10-02
Status: Accepted for standalone extraction; production migration pending.

## Context

SPIKE's custom PCB and results presentation is built on Three.js and React but
its implementation resides beside desktop workflows. Independent work on 2D/3D
behavior and general virtual data needs a runnable, testable package boundary.

## Decision

Create `standalone/spike_viewer` as a self-contained TypeScript/React package and
demo using an explicit snapshot of the existing board viewport import closure.
Extract normalized board types without copying source-format parsing, Tauri,
workers or persistence. Keep React and Three.js as peer dependencies.

Add versioned, board/revision-bound virtual layers with scalar points, vectors,
supplied triangles, paths, labels and retained frames. Both renderers preserve
source coordinates and picks. Data admission bounds resources and preserves
units, missing values and source qualification metadata.

No new implementation language is introduced. This standalone source root is
owned by the visualization project and its package checks. The existing desktop
production path remains unchanged until a separate tested migration.

## Consequences and validation

The directory can be developed, built, packed or moved independently. Initial
source duplication is explicit; production migration must eliminate it after
parity checks rather than establishing recurring copy/sync automation.

The package enforces portable imports, TypeScript checks, behavior tests and
library/demo builds. Runtime acceptance exercises 2D/3D, picks, frames, imports,
and responsive layout. Existing large viewport modules are inherited debt.
Generic multiboard occurrence overlays and additional volume/tensor displays
remain future work; their availability is not implied by the primitive API.
