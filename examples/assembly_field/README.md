<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Assembly field mesh example

This independently authored mathematical example demonstrates geometry
handoff, explicit contact conduction, local mesh modification, offline saved
results and radiation geometry. It is not a real PCB or enclosure qualification.
Two one-metre homogeneous solids use logical board/case occurrence types to
exercise retained identity. No board/CAD data or external implementation was
copied.

## Run and inspect the inputs

From the repository root, use the project Python environment with NumPy, SciPy,
jsonschema and worker dependencies installed:

```powershell
python examples/assembly_field/run_examples.py
```

Read `setup()` in [run_examples.py](run_examples.py) to see the full input.
Each occurrence has eight vertices, six positive tetrahedra, complete exterior
faces, a retained source binding and material mapping. The case is placed
1,000 mm along X. Both conductivities are 2 W/(m K). The board/case exterior
temperatures are 300 K and 400 K. The matched contact has area 1 m2,
conductance 4 W/(m2 K), and retained resistance 0.25 K/W.

## Expected thermal outputs

The two bulk resistances are each 0.5 K/W. With the contact resistance,
`Q = (400 - 300)/(0.5 + 0.25 + 0.5) = 80 W` flows toward negative X.
Expected temperatures are 300-340 K in the board and 360-400 K in the case;
the cell flux is `[-80, 0, 0]` W/m2. The script asserts contact transfer and
heat conservation; a discrepancy causes failure, not just a printed warning.

The locally refined example bisects edge `[0,4]` in each local solid before
handoff, preserves source ownership, reconstructs exterior faces and rebinds
the contact. Cells increase from 12 to 16 and nodes from 16 to 18. This affine
solution remains exact within floating-point tolerance. The changed request
digest means an old result must not be reused on the modified mesh.

The script prints request/result SHA-256 digests, occurrence temperature ranges,
heat balance, and resource counts. These are actual returned numerical values,
not rendered field guesses. Export/import checks a JSON-round-tripped study
snapshot; dedicated tests also save and reopen the record inside `.spike`.

## Inspect EM and radiation handoffs

The EM example retains two conductor volumes and an explicit signal/return
port. It asserts `executable: false` and prints the pending backend diagnostic;
it does not claim a Maxwell or SI channel solution.

Two opposed unit squares separated by one metre yield an independently
evaluated analytical view factor of `0.199824895698`. Level-five quadrature
returns approximately `0.199864129642`, with absolute error below `4e-5` for
this unoccluded fixture. The unresolved remainder is not automatically ambient.
The output error bound is `null`: this comparison does not establish a general
shadow integration bound or nonlinear radiation thermal solve.

For API details, manual/indicator refinement choices, input limits and recovery
behavior, see [retained assembly field workflow](../../docs/ASSEMBLY_FIELD_HANDOFF.md).
