<!-- SPDX-License-Identifier: Apache-2.0 -->
# Board and mechanical structure reduced studies

## Scope

The existing reduced solver contracts now accept physical AssemblyIR parts as
explicit model owners alongside boards. Casings, heatsinks and standoffs can
participate with reviewed properties. All physical parts require coverage;
model-less subassembly hierarchy containers are reported exclusions. One board
plus one physical part is admitted. Existing board-only request identities and
numerical laws remain compatible.

| Domain | Executable structure effect | Limits |
| --- | --- | --- |
| Thermal | Part RC nodes, board/part contacts, reciprocal diffuse-gray radiosity, steady/transient temperatures | Explicit properties and view factors; no STEP-to-solid conduction, occlusion extraction or airflow |
| SI and PI | Passive part RLC and explicit retained electrical bond R/L in shared native MNA | Linear reduced models; no geometry-derived impedances, distributed chassis modes or automatic ground |
| EM | Part-owned reciprocal magnetic loops and induced-current/loss results | Authored loop equivalent; bonds/rigid-flex rejected; no general shielding, dielectric loading or full-wave fields |

Unknown owners, mismatched retained contact/bond endpoints, omitted physical
parts and nonphysical values fail admission. Missing ambient rejection paths,
thermal capacities and floating circuits preserve blocked/failed statuses.
Part placement, structure metadata and exact model parameters are bound to
result digests. Results remain approximate and production_qualified=false.

## Independent evidence

- `test_multiboard_thermal_parts.py`: analytical two-node board/case and
  three-node board/board/case balances; transient step refinement and heat
  storage conservation; independently evaluated surface exchange, reciprocal
  view-factor membership; explicit radiation-only ambient rejection and closed
  floating enclosure rejection.
- `test_multiboard_circuit_parts.py`: complex series/parallel impedance transfer
  with a chassis RLC branch; bond resistance sensitivity; separate local `0`
  and duplicate element names; explicit part datum; floating return rejection.
- `test_multiboard_em.py`: independent two-loop complex-current expression,
  zero-mutual isolation, power balance and passive inductance guards with a
  board and conductive casing loop.
- `test_multiboard_structure_studies.py`: generated incomplete setup coverage,
  typed contacts/bonds, all three solved domain outputs saved as verified state
  artifacts and hydrated after offline `.spike` reopen; embedded model identity
  preservation and changed casing placement rejection. Its minimal STEP bytes
  exercise package identity only, not solid geometry or field accuracy.
- Frontend presentation and form tests cover typed owner guards, part result
  tables, passive-element and thermal-capacity editing, named structure labels
  and explicit bond-node changes. Worker contracts own physics.

These tests extend existing numerical formulations; no external implementation,
mesh or research test dataset was copied. Hardware correlation, field-solver
convergence and knowledgeable human numerical review remain required for
release qualification.

## Checks performed

The focused solver/study/package group passed 99 tests; the additional
unfinished-type-change regression passed in the six-test structure-study group.
The frontend structure-study suite, assembly workspace suite, TypeScript check,
button standard, production build, architecture guard, eight-file documentation
check and scoped diff whitespace check passed. Production build retains the
existing mixed-import and large-chunk warnings. Native GUI visual acceptance
and external/hardware field-solver qualification were not performed for this
change; component callback tests and package reopen checks establish different
facts from native visual verification.

## Solver suite implementation handoff

The user-authorized handoff was sent to the existing task **Build modern SPIKE
solver suite** on October 4, 2026. Remaining requirements:

1. Full retained occurrence/material/transform handoff to bounded field-capable
   Thermal/EM/SI adapters and traceable source-to-mesh identities.
2. Solid/contact conduction and geometry-derived reciprocal view factors with
   occlusion; explicit convection/airflow scope and failure diagnostics.
3. Conductive/dielectric casings, shields and multi-stack boards in field EM/SI,
   explicit ports/feeds/returns/bonds and connector/harness parasitics.
4. Independent reference, conservation/passivity/reciprocity and mesh-convergence
   checks, portable setup/results and stale-result invalidation.

This handoff is work requested, not an executed or qualified field solver.
