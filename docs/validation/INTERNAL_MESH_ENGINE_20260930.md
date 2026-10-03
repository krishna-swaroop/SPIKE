# Internal tetra mesh engine qualification

The September 30, 2026 Windows checkpoint verifies bounded internal tetrahedral
generation, adaptive refinement, scalar refinement transfer and interior quality
optimization. It does not qualify general PCB/CAD meshing, a field solver,
Linux/MPI execution or a public release.

## Executed checks

| Check | Observed result |
| --- | --- |
| Focused generator, adaptation, worker, refinement and optimization suite, warnings as errors | 50 tests passed |
| Broader `*mesh*.py` regression discovery, warnings as errors | 125 tests passed; overlaps the focused suite |
| JSON-line worker subprocess | Capability probe and actual generation passed |
| Generic point-cloud independent oracle | Connectivity agrees with installed SciPy Delaunay for three 40-point fixtures; exact volumes agree with hull volume |
| Cospherical and coplanar-boundary cases | Cube, 27-point lattice, octahedron and edge/face insertion passed without coordinate jitter |
| Maximum input fixture | 128 points, 685 cells admitted within predicate/cell budgets |
| Feedback-driven interpolation refinement | Four refinements, 6→12→24→48→96 cells; exact quadratic L2 interpolation error decreases by more than 30% each pass, final error less than 17% of initial |
| Python compile checks | Passed for new engine, service, examples and integration tests |
| Changed tracked-file whitespace check | Passed |
| Final repository architecture check | Failed on concurrent `app/src/emViewportResults.ts` large-array spread extrema; earlier checks passed |

The focused command was:

```powershell
.\.venv\Scripts\python.exe -W error -m unittest tests.python.test_internal_tetra_generation tests.python.test_dynamic_tetra_adaptation tests.python.test_internal_meshing_engine tests.python.test_tetra_mesh_refinement tests.python.test_tetra_mesh_optimization -q
```

The broad command was
`.\.venv\Scripts\python.exe -W error -m unittest discover -s tests/python -p '*mesh*.py' -q`.
No full-repository test-suite or clean-machine release result is claimed.

## Example artifacts and numerical outcomes

Run artifacts are in
`build/internal-mesh-qualified-example-20260930/`. They include seven complete
candidate JSON files, `evidence.json` and `sha256.json`. The evidence-file SHA-256
is `579f2c1ae23678b5b0216defe1fba94106b8453dfc5fbce6251716ef46a3a2f7`.
Build artifacts are not a source dependency; regenerate them using the
[checked-in runner](../../examples/internal_meshing/run_examples.py).

The non-cuboidal example has five vertices, four tetrahedra and volume
`0.3333333333333333 mm^3`. Automatic smoothing raises minimum mean-ratio quality
from `0.08611022627979487` to `0.35875159138600493` (4.166×), preserving exterior
coordinates and volume. Its protected-vertex variant does not move the protected
interior vertex. Manual refinement creates six vertices and six cells with
zero measured affine-field interpolation error and zero constant-density
integral difference. Refinement reduces its shape metric to `0.27613`; improved
resolution is not asserted to improve element shape.

One warm-up and five measured seven-case corpus runs produced a median
`0.0160257 s`, excluding output-file writes and interpreter startup. Environment:
Windows 11 build 26200, AMD64, Python 3.12.9, MSC v.1950. These tiny-case timings
are execution evidence, not a scalable performance comparison. The report
contains hashes for the generator, controller, worker boundary, existing mesh
primitives, service composition, schema, runner and fixture, and rejects source
changes during its run. Runtime numerical execution uses the Python standard
library; independent test oracles additionally use SciPy and jsonschema.

## Review findings incorporated

An independent numerical review identified subnormal loss in scalar midpoint
interpolation and field integrals, positive-indicator omission at full bulk
marking, and overstrict signed per-material cancellation checks. Permanent tests
now preserve subnormal nodal constants, reject materially unrepresentable
integral/interpolation values, include all positive indicators at fraction one,
and use each material's absolute contribution scale for roundoff tolerance.
The controller also enforces the advertised 32-scalar-field limit.

Original code, synthetic fixtures and rational determinant/volume oracles were
authored for SPIKE. No external mesher source was read or adapted. This provenance
statement concerns the increment; it is not certification of the entire historic
repository. Mathematical research context, implemented invariants and remaining
limits are recorded in [the engine guide](../INTERNAL_MESH_ENGINE.md).

## Remaining qualification

Arbitrary constrained/multi-material CAD generation, copper/via/terminal/port
surface recovery, global intersection admission of imported meshes, coarsening,
anisotropic/high-order/boundary-layer meshing, conservative relocation remap,
large native/distributed execution, Linux coverage and knowledgeable human
numerical review remain open. Candidate `production_qualified` is false. This
increment neither fixes nor bypasses the separate Marble copper-support defect.
