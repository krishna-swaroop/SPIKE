# Whole board focused volume meshing

Status: Implemented experimentally; production and redistribution review required.

## Context

Net-focused physics needs a smaller mesh near relevant conductors without removing
background return paths, aggressors, dielectric layers or thermal spreading paths.
The existing global-size typed OCC process accepts a small solid set. The internal
convex-point generator cannot represent constrained, perforated PCB stacks.

## Decision

Add a CAD-neutral normalized PCB volume compiler and an independent box-sizing
policy. The versioned request carries the complete declared geometry, selectors,
manual regions and resource budgets. Keep source/format conversion separate.
Expose preparation and capability probing in the worker; reuse the fixed-argument
external tetrahedral process for execution through `spike/gmsh-occ-mesh/v2`.
Preserve v1 admission budgets and behavior. No language or numerical dependency
direction changes; Gmsh remains separately installed and local-development-only.

Selection changes element sizing rather than solid inclusion. Fragment ancestry,
material priority, actual tetra coverage and shared interfaces carry ownership
across the boundary. Requested sizing and realized-cell diagnostics are separate.
Do not duplicate complete solid/mesh arrays in focus diagnostics. Bound controls,
geometry, Boolean fragments, fields, contact work and assessment work explicitly.

## Consequences

The shared neutral mesh can feed compatible SI, EM or thermal adapters, but needs
their material values, excitations, boundary/port mappings and convergence checks.
No solver is promoted by successful meshing. Linear curved-boundary error and low
tetrahedral quality remain visible. Automatic importer-to-volume conversion,
bent rigid-flex, high-order/anisotropic cells and distributed/native scalability
remain separate work. No vendor source or example was adapted for the new code.

The Windows runner bypasses venv executable redirectors, preserving a one-process
Job Object. Base Python starts with `-I -S`; configured package directories are
appended explicitly without executing `.pth` files. It is not a network/filesystem
sandbox or full transitive DLL admission. Complete worker-environment and clean
package qualification remain required.

See [workflow and scope](../PCB_FOCUSED_VOLUME_MESHING.md) and
[executed evidence](../validation/PCB_FOCUSED_VOLUME_MESHING_20261001.md).
