<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Assembly field mesh and thermal validation

The October 4, 2026 Windows checks support an experimental retained-volume
handoff and bounded steady solid-thermal reference path. They do not qualify
arbitrary PCB/CAD extraction, full-wave SI/EM, radiation thermal coupling,
airflow or a production release. Two independent numerical reviewers supplied
the thermal/view-factor kernels and adversarial review; the integration owner
reviewed and reran their checks. Human numerical release review remains open.

## Reproduction environment

The final focused runs used `.venv/Scripts/python.exe`, CPython 3.12.9,
MSC v.1950, NumPy 2.4.2, SciPy 1.17.0, jsonschema 4.25.1 and PyArrow 25.0.1
on Windows build 26200. Python 3.11.9 with NumPy 2.4.6/SciPy 1.17.1 also
passed the same 125 focused mesh/field checks. No dependency was downloaded,
installed or bypassed for this work.

From the repository root:

```powershell
& .venv/Scripts/python.exe -Werror -m unittest tests.python.test_assembly_field_handoff tests.python.test_assembly_field_geometry tests.python.test_assembly_field_admission_review tests.python.test_assembly_tetra_thermal tests.python.test_assembly_view_factors tests.python.test_tetra_mesh_refinement tests.python.test_tetra_mesh_optimization tests.python.test_dynamic_tetra_adaptation tests.python.test_internal_meshing_engine tests.python.test_internal_tetra_generation tests.python.test_pcb_focus_sizing tests.python.test_pcb_volume_compiler tests.python.test_pcb_volume_mesh tests.python.test_tetra_mesh_worker
& .venv/Scripts/python.exe -Werror examples/assembly_field/run_examples.py
python scripts/check_architecture.py
```

All 125 focused checks passed in both tested interpreters. They include an
actual JSON-lines worker subprocess and an offline `.spike` ZIP save/reopen.
Architecture checks passed. No frontend, Rust or native C++ source changed
in this field slice; their full build/sanitizer/Linux qualification was not run.

## Mathematical evidence

The exact slab test checks affine temperatures, Fourier flux, reactions and
SI conversion. Rotated tensor tests check local-to-world conductivity rather
than treating anisotropy as scalar. For two 1 m2 slabs with k=2 W/(m K),
length 1 m each, and contact h=4 W/(m2 K), the independently derived series
resistance is 1.25 K/W. At exterior temperatures 300/400 K, both base and
manually refined meshes return 80 W toward negative X, contact temperatures
340/360 K and `[-80,0,0]` W/m2 cell flux. Heat imbalance is
`-3.979039320256561e-13` W for 12 tets/16 nodes and
`-1.7053025658242404e-13` W for 16 tets/18 nodes. Both solves have one connected
thermal component and distinct occurrence nodes at the finite-resistance contact.

For `T=300+sin(pi*x)sin(pi*y)sin(pi*z)`, k=1 and centroid-sampled
`q=3*pi^2*(T-300)`, uniform grids with n=2/3/4/8 use 48/162/384/3,072 tets.
Cell-centroid RMS temperature error decreases through
0.278364881526, 0.169425561933, 0.107541805131 and 0.0305343802484 K.
The last h-halving gives an observed RMS order about 1.82. This is a
manufactured convergence diagnostic, not an integrated H1/L2 qualification
for all element orders. Maximum free relative residual is 1.84e-13 and heat
imbalance is at most 2.86e-11 W for this corpus.

Opposed unit squares at unit separation have analytical F=0.199824895698.
Independent midpoint-subdivision quadrature levels 0-5 decrease absolute error
through approximately 0.06587, 0.01099, 0.002561, 0.0006307, 0.0001571 and
0.00003923. Final F=0.1998641296422404. Exchange-area construction enforces
reciprocity; tests also cover rotation/translation/scale, full and partial
occlusion, backfaces and non-inferred ambient. Level changes are not rigorous
shadow-error bounds. The reference geometry is the
[Howell C-11 catalog](https://www.thermalradiation.net/sectionc/C-11.html);
code, evaluated analytical oracle and meshes are independently authored.

## Defects caught and regression protection

- A proper large translation preserved aggregate volume but distorted individual
  tetra Jacobians. Per-cell determinant, Jacobian and inverse-Jacobian checks
  now reject the reproduced defect; exact and rotated SI conversion still pass.
- A correctly rehashed but malformed stored result could previously pass
  integrity-only admission. Admission now checks nested solver contract/status,
  mesh counts, finite nonnegative temperatures, ownership, flux vectors,
  reported conservation/residual and qualification limits. Rehashing is not
  treated as authenticity or proof of correct physics.
- Caller contact conductance could disagree with retained contact area or
  resistance. Matched face area and `1/(h*A)` now reconcile against retained
  values. Incorrect area/resistance and unsupported perfect contact fail closed.
- Missing volumes/materials, unknown references/fields, invalid hashes/frames,
  intersecting bodies, incomplete contacts, unknown faces, unsupported links
  and changed geometry/material/load bindings are rejected. Separate instances
  of one source do not collide or weld automatically.

## Broader qualification outcome

An initial system Python 3.14 run lacked several required dependencies and is
not release evidence. The subsequent broad Python 3.11 discovery run completed
2,514 tests in 460.391 seconds with one failure, 14 errors and eight skips.
Twelve errors were missing PyArrow support; two were the unwritable default
model-library SQLite cache. These were environmental failures, not field-kernel
failures. Using the pinned project `.venv` and a temporary
`SPIKE_MODEL_INDEX_PATH`, all 47 checks covering the affected Arrow/package
modules and model-library/staged-import cases passed. The complete broad suite
was not rerun in that restored environment, so it is not reported green.

The independently rerun `test_public_release_readiness` still has one failure:
its expected blocker set contains `PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`,
but the current release evidence omits that code. Neither the approval records
nor the test was weakened in this work. Owner review of that policy/evidence
disagreement remains necessary before claiming full-suite qualification.

## Pinned example identities

Base request SHA-256:
`735cb09e54763bae18172358f31d84969b5cc43ded028efc0fee695cbf482c86`.
Base result SHA-256:
`da6b9289dbef6cbc7c3010c1e6965cf497d803a1fdfbfa111875c0792bf4dfb6`.

Manually refined request SHA-256:
`43f5b4aabdadeaa641d3d22f90767a480ac10afb1370d67308455f1257cf0689`.
Manually refined result SHA-256:
`fd45847b287fcdac34ed5602921b90744fc58bdd92f0e26e1d74727e5fc9a9f1`.
Both tested interpreters returned these exact example identities. This does
not promise bitwise reproducibility on untested machines or solver versions.

See [the workflow and limits](../ASSEMBLY_FIELD_HANDOFF.md) and
[guided example](../../examples/assembly_field/README.md). General retained
assembly Maxwell/SI execution remains explicitly unavailable; meshes and ports
are preparation artifacts, not simulated fields.
