# SPIKE icon system

SPIKE uses an original 24 by 24 line-icon vocabulary for its engineering
workbench. The source lives in `app/src/icons/index.tsx`; it is Apache-2.0
project artwork authored for SPIKE and is not copied from EDA or simulation
products. The SPIKE wordmark and product identity are unchanged.

All desktop components import icons from `./icons`. The local barrel exports 60
native engineering and common-action glyphs, their searchable metadata, and the
remaining `lucide-react` names as an MIT-licensed compatibility fallback. This
keeps existing extension and panel imports stable while native coverage grows.
Only the barrel imports `lucide-react` directly.

Native icons share these invariants:

- `0 0 24 24` view box;
- 1.8 default stroke, `currentColor`, no fill;
- rounded caps and joins;
- `size`, `className`, `style`, `strokeWidth`, and `absoluteStrokeWidth` props;
- decorative `aria-hidden` behavior by default;
- `role="img"` for an accessible label or external `aria-labelledby`, and a
  `<title>` when an `aria-label` is supplied.

The exported `workbenchIconInventory` records the component, name, category,
and short semantic description used by the Settings > Icon gallery. The gallery
is a developer and product reference, not an icon picker that mutates the UI.
Search by icon name, engineering meaning, or category. Tooltips repeat the short
meaning so visually similar quantities can still be distinguished.
Escape closes the gallery without triggering viewport commands. Search and
category controls have explicit accessible names.

Prefer the semantic engineering glyphs for RF, PI, SI, thermal, board, MCAD,
ports, mesh, probes, materials, plots, tables, reports, and Python workflows.
Use fallback generic symbols only when the native inventory has no accurate
meaning. Do not substitute vendor logos or imply compatibility through copied
artwork.

Run the deterministic checks from `app`:

```powershell
npm.cmd run test:icons
npm.cmd exec tsc -- --noEmit
```

The native-pack test renders representative icons and verifies geometry,
view-box, stroke, prop forwarding, absolute stroke scaling, and accessible versus
decorative output. The existing vocabulary test continues to protect distinct
icons for ribbon commands.
