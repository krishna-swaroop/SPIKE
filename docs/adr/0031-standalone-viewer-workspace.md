# ADR 0031: Standalone viewer panel workspace

Status: Accepted for the standalone engineering preview, 2026-10-03

## Context

The extracted viewer needs independently movable controls, floating and docked
panels, and usable narrow/short layouts for assembly and virtual-data work.
The center viewer and panel drafts must survive rearrangement. Storage and
native window services must remain outside the portable rendering core.

## Decision

Expose a controlled React `DockWorkspace` and versioned layout model from
`standalone/spike_viewer`. Provide left/right/bottom tabbed docks, bounded
floating rectangles, resize/move controls, viewport focus, and compact drawers.
Keep the viewer mounted and move stable portal hosts between panel shells.
Keep browser preference persistence in the demo host, separate from assembly
and result documents. Add no third-party docking dependency.

## Consequences

Both standalone labs share behavior and can recover closed/off-screen panels.
Layout changes do not recreate board rendering or rewrite source data. The
host validates/restores saved layout preferences and handles storage failure.
Browser interaction and responsive checks accompany pure layout behavior tests.
Floating here means an in-workspace panel; native OS windows, cross-monitor
docking and arbitrary nested split trees require additional design. This ADR
does not migrate the production SPIKE desktop application.
