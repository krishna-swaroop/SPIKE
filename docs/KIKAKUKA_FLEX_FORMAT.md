# KiKakuka / FreekiCAD flex-board interoperability

SPIKE imports the bend-line convention documented by the upstream
[KiKakuka project](https://github.com/buganini/Kikakuka#flexible-pcb-bending).
This contract was audited against upstream `main` commit
[`3f8a1384d81427c189ab78bf00dc39221bdbb2bf`](https://github.com/buganini/Kikakuka/tree/3f8a1384d81427c189ab78bf00dc39221bdbb2bf)
on 2026-10-04. The implementation is an independent parser of
the documented KiCad data contract; no upstream source code or sample board is
copied into SPIKE.

## Source format

- Rename a KiCad graphical user layer to `FreekiCAD`. Matching is
  case-insensitive; the physical `User.*` layer name is retained as provenance.
- Every `gr_line` on that layer is a bend line. Its serialized start-to-end
  direction is retained because signed bend angle semantics depend on it.
- A global `gr_text` on the same layer annotates a bend when its anchor is at
  most 0.1 mm from either endpoint. The nearest line wins, with KiCad source
  order as the deterministic tie break. Orphan, ambiguous, and conflicting
  annotations produce structured issues.
- `a` is bend angle in degrees, `r` is radius, and `s` is the full bend span.
  Keys may appear in any order with optional whitespace and `=` or `:`.
- Lengths accept `mm`, `cm`, `um`, `µm`, `μm`, `in`, and `mil`,
  case-insensitively. A missing length unit means millimetres. `deg` is accepted
  for angle.
- If both `r` and `s` are present, `r` takes precedence and the conflict is
  retained as an informational issue. With only `s`, SPIKE derives
  `r = s / abs(angleRadians) - boardThickness / 2` only when a non-zero angle
  and explicit summed stackup thickness are available.
- Radius zero is valid. A negative explicit or derived radius is preserved as
  source data and receives `KIKAKUKA_BEND_RADIUS_NEGATIVE`; consumers must not
  use it as bend geometry.
- Non-finite annotation values, unit-conversion overflow, and non-finite
  span-derived radii are never placed in bend metadata. Their original text is
  retained, the affected parameter remains unset, and a structured malformed
  or `KIKAKUKA_BEND_RADIUS_NONFINITE` issue explains the rejection. Span-based
  derivation also requires the summed explicit stackup thickness to be finite.
- An unannotated or malformed line is retained as a bend definition with unset
  parameters and structured issues. It never becomes a deformed mesh or proof
  that a solver supports folded geometry.

SPIKE also preserves its earlier named-layer convention: a user-layer label
containing `Bend` supplies bend lines and may include `R`/`Radius` and
`A`/`Angle`; named `Flex`, `Rigid`, `Transition`, and `Stiffener` layers supply
region outlines.

## SPIKE projection

The parser exposes the following optional bend fields in addition to `id`,
`name`, `points`, `sourceLayer`, `radiusMm`, and `angleDeg`:

- `spanMm`, `radiusSource`, `configured`
- `annotation`, `annotationPosition`
- `sourceLayerUserName`, `sourceDrawingId`, `source`
- `format` (`kikakuka/freekicad-v1`)
- `issues[]` with `code`, `severity`, and `message`

Python worker records use the equivalent snake-case names. Normalized snapshot
projection maps `design.regions` and `design.bends` into these viewport fields
without changing solver geometry. The v2 bridge retains the full original bend
record in its existing `extensions["spike.v1"]` payload.

When FreekiCAD bends exist without explicit SPIKE flex-region geometry, SPIKE
classifies a board with no explicit regions as `flex` and adds a display-only
full-board flex region. If an explicit rigid region exists, it classifies the
board as `rigid-flex` without inventing a flex boundary. Both cases emit
`KIKAKUKA_FLEX_REGION_IMPLICIT`. Existing explicit region geometry continues to
control technology classification.

## Scope

The imported data supports read-only GUI inspection, annotation copy, definition
export, project source persistence, and the existing flat-board rigid-flex
preflight policy. Bend definition editing remains in native KiCad/KiKakuka.
SPIKE does not currently reproduce
FreekiCAD's folded solid generation, wedge tessellation, component transforms,
or material/finite-element mechanics. KiKakuka stiffener annotations are also
outside this bend-line interoperability contract.

## Native validation

On 2026-10-04, a disposable clean-room KiCad board containing a `FreekiCAD`
user layer, one bend line, and `a=90 r=0.5mm` was accepted by installed
`kicad-cli` 10.0.6 and exported as a single SVG with `Edge.Cuts` and the physical
user layer selected. The same source parsed to one configured bend with angle
90 degrees and radius 0.5 mm. The disposable board and SVG are not repository
fixtures; the unit tests construct independent source strings in memory.
