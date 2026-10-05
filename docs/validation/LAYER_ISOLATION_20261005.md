# Board layer isolation verification — 2026-10-05

## Failure and repair

A change to any layer previously disabled the entire imported board and enabled
generated geometry. An unrelated solder-mask eye could therefore change copper,
laminate and silkscreen together. Generated outer copper also shared laminate
depth and used one-sided faces in the assembly renderer.

Both renderers now address imported surfaces by board side and layer before
batching. Materials are independent by layer and occurrence. Combined copper
triangle ranges are separated once; unaddressable surfaces use retained geometry.
Pad-only exports cannot claim complete copper coverage. Board-body controls do
not gate the copper parent. Generated outer copper clears laminate depth on both
sides. Component models and unresolved stand-ins are independent of copper eyes.

## Executed checks

- `test-imported-board-layers.mjs`: transformed surfaces, material independence,
  combined-mesh triangle conservation and 24,692 real KiCad export fragments.
- `test-viewport-layer-visibility.mjs`: actual renderer traversal and batching,
  2/6/12/16/32-layer controls, imported masks and pad-only fallback.
- `test:viewport`, `test:assembly-layout`, `test:assembly-board-managers`,
  `test:large-scene` and `test-assembly-scene-visibility.mjs`: passed.
- TypeScript, architecture/control standards, changed documentation and
  production frontend build: passed. Build transformed 2,006 modules.

These checks establish source-level rendering behavior. The installed Windows
application has not been rebuilt or updated with this fix, and native visual
acceptance of that updated application remains outstanding. No solver or
numerical validation claim is made by these rendering checks.
