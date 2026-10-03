# ADR 0032: KiCad viewer replacement as a standalone engine target

Status: Accepted direction, 2026-10-03; integration not yet implemented.

## Context

The independent SPIKE viewer is intended to become capable enough to be used
instead of KiCad's internal 3D viewer, while retaining multiboard MCAD assembly,
virtual data and flexible workspaces. Version 0.3 remains a preview and lacks
native component-model loading in its assembly path and a live KiCad bridge.

## Decision

Make qualified KiCad viewer replacement an explicit product target. Implement
native geometry/model parity first, then a separately launched read-only KiCad
IPC integration, everyday workflow parity and measured workload qualification.
Use one rendering core for the standalone application, SPIKE and KiCad hosts.
Keep IPC, file/model resolution, conversion and native windows in host adapters.
Use exact editor, document, object and revision identities; do not conflate
saved-file snapshots with unsaved live editor state.

Keep integration inside KiCad's own 3D window as a later, separately evaluated
host milestone. The documented 3D plugin interface loads models; it is not a
documented renderer replacement API. The external IPC route does not itself
replace the internal renderer or the built-in viewer shortcut.

## Consequences

The standalone project's `docs/KICAD_VIEWER_TARGET.md` owns milestone gates,
current gaps, qualification fixtures and upstream references. Capability claims
remain tied to `docs/VALIDATION.md`. Existing interfaces stay unchanged by this
decision. No KiCad installation, plugin or user board is modified. Full viewer
replacement is not claimed until the applicable gates pass.
