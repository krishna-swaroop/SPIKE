---
name: spike-ui
description: Develop and verify SPIKE desktop interfaces, including PCB viewports, assembly managers, responsive controls, and analysis panels. Use for SPIKE UI implementation and visual defects; use the KiCad editing skill for native PCB edits.
---

# SPIKE UI development

Locate the SPIKE repository from the active workspace. Read its applicable AGENTS.md, CONTRIBUTING.md, and docs/SUBSYSTEM_INDEX.md before changing unfamiliar ownership boundaries. Consult docs/SOLVER_STATUS.md when displaying analysis capabilities or results.

## Layout and interaction

- Keep toolbars, status messages, and notifications in explicit flex or grid rows. Independent absolute positioning must not put interactive controls in the same space as titles, selection status, notices, or legends. Reserve canvas space for persistent controls.
- Scope form styling to the component: explicit font, control height, padding, and focus indication. Do not inherit presentation typography into selects and buttons.
- Give flexible children min-width: 0 and bounded widths. Long board, connector, file, and net names need ellipsis with accessible full text, or wrapping when the information is diagnostic. Keep action buttons usable when adjacent text grows.
- Test simultaneous states: selected board plus unresolved model notice, expanded import diagnostics, open inspectors, and long names. Dismissing a notice is not a layout fix.
- Preserve keyboard focus, accessible names, pointer capture for canvas drag, and hit targets. Controls must not initiate viewport pan or interfere with board selection.

## PCB and assembly contracts

App.tsx owns workspace state and persistence; BoardViewport.tsx owns WebGL scenes and interaction. AssemblyLayoutViewport.tsx and its scoped CSS own the SVG assembly view. AssemblyBoardManagers.tsx and assemblyBoardManagerModel.ts own occurrence-specific layers, nets, and explicit connector pin maps. Recheck the subsystem index if these move.

- Key net identity by board occurrence and canonical net ID. Equal names on different boards establish no electrical connection. Only explicit saved connector mappings propagate linked selection.
- Keep per-board layer visibility and opacity separate; preserve them through native save/open. Retain all model assignments and transforms. Replace proxy components only where authoritative model geometry actually resolves.
- Reuse scene geometry for selection, layer visibility, and opacity updates. Keep GPU resources bounded and dispose owned resources. Check both normal and assembly rendering; a fallback viewport is not evidence that the native models loaded.
- Preserve source coordinates. Derive board placement from matched connector geometry and verify mapped pad positions in assembly coordinates.
- Surface missing geometry and model diagnostics by board. Do not label reduced circuit, thermal, or magnetic approximations as full-wave assembly EM or validated manufacturing results.

## Acceptance evidence

Choose focused parser, scene, layer, manager, and persistence checks for the changed behavior, then run the required project gates. Read package.json for current commands rather than inventing them.

Use actual native SPIKE screenshots for visual acceptance, with the computer-use skill and supported UI APIs when available. Observe the window before acting and after each meaningful action. Exercise a representative wide window and a narrower supported window, with inspectors open and realistic long names. Inspect for clipping, overlap, absent boards, incorrect models, and inaccessible controls. Generated mockups cannot establish runtime behavior.

For multi-board changes, use a retained real assembly fixture and show the 2D view, 3D view, per-board managers, and explicit connector mappings that were exercised. Reopen the saved project when persistence is part of the task. Report actual checks, screenshots, and remaining limitations; never claim an unobserved screen or solver run passed.
