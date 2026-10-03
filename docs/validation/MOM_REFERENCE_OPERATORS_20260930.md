<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Bounded surface-EM reference operators — 2026-09-30

## Status and provenance

These are internal numerical foundations, **not** a runnable surface-MoM
solver. No EFIE matrix, PEC current solution, scattering convergence, antenna
feed, material model, or compliance result is claimed. Geometry supplied to
the RWG basis has topological checks but is not proven intersection-free.

The derivations used the governing free-space Green function, the
[RWG surface-current formulation](https://doi.org/10.1109/TAP.1982.1142818),
the general singularity-removing idea of
[Duffy's transformation](https://doi.org/10.1137/0719090), and
[radiation-potential asymptotics](https://web.mit.edu/6.013_book/www/chapter12/Backup/12.4.html).
The numerical source integration, postprocessor and oracles are independently
authored; no external solver code, meshes, figures, or datasets were copied.
The far-field vacuum constants use [NIST CODATA 2022](https://physics.nist.gov/cuu/pdf/all.pdf).
These modules use Python, the existing SPIKE RWG basis and NumPy; they do not
invoke or require a third-party field solver at runtime. The equations and
oracles establish independent authorship of this increment, not a legal
certification of every earlier file in the repository.

## Implemented and checked

With the `exp(+i omega t)` convention, the outgoing kernel is
`exp(-i k R)/(4 pi R)`. `integrate_triangle_green` returns its integral over
one planar source triangle [m] and an observation-relative first moment [m²].
For a source point at a vertex of the unit right triangle, an independent
polar/fan derivation gives the exact static scalar
`sqrt(2) asinh(1)/(4 pi) = 0.09918937762795121 m` and x/y moments
`asinh(1)/(8 sqrt(2) pi) = 0.0247973444069878 m²`. The local test run returned
`0.09918937762795117 m` and `0.02479734440698779 m²` at order 24; the last
scalar order change was `1.35e-14 m`. Tests also cover the off-surface zero-gap
limit, an independent hypotenuse-midpoint exact scalar
`asinh(1)/(2 pi) m`, outgoing-wave phase sign, far-static monopole limit, rotation,
translation, size/frequency scaling, malformed input and nonconvergence.
An independent review found a precision-loss case: a 1 mm triangle observed
from `(10^12,10^12,10^12) m` had falsely converged with a 4.63% scalar error
when source edges were formed *after* subtracting the observation. The kernel
now forms source-local geometry first. Its rerun gives
`2.2972037309241332e-20 m`, compared with the far-monopole limit
`2.2972037309241335e-20 m` (relative difference about `1.1e-16`). Mixed
Boolean/numeric coordinates are also rejected before array coercion. Both
defects have permanent regression assertions.

`evaluate_far_field` consumes *supplied* full-RWG current coefficients [A/m]
and evaluates `F(s) = integral J(x) exp(+i k s.x) dS` [A·m]. Its transverse
electric amplitude is `-i omega mu0 (I-ss^T)F/(4 pi)` [V], where
`E(r s) ~ exp(-i k r) E_inf/r`. Conditional bistatic RCS is
`4 pi |E_inf|²/|E_inc|²` [m²]; the incident direction/amplitude are supplied
metadata, not a solved excitation. A planar normal-observation fixture has
constant phase, so its independent affine-simplex current integral is exact.
The local run returned `F = (0.47140452079103157+0.18856180831641262i,
-0.4714045207910318-0.1885618083164127i, 0) A·m`; order 4→8 changed it by
`2.72e-16 A·m`. A separate analytic simplex-series oracle and rigid/scale
invariants test nonconstant phase. These numbers verify integration of that
*prescribed current*, not the correctness of a scatterer or an RCS prediction.

Focused run: `.venv/Scripts/python.exe -m unittest
tests.python.test_mom_far_field tests.python.test_mom_singular_source
tests.python.test_mom_surface_basis -q` — **26 tests passed**.
`scripts/check_architecture.py` passed. Results were obtained locally on
Windows; independent engine/hardware correlation was not run.

## Admission and remaining gates

- Source integration limits orders to 32 and rejects electrically oversized
  triangles or unresolved near cases. Projected-inside/on-surface singularities
  receive an exact static radial factor; a near point outside the triangle may
  still exhaust the bounded quadrature and is rejected. The reported
  order-to-order difference is a convergence indicator, not a rigorous error
  bound or a complete singular triangle-pair treatment.
- Far-field postprocessing caps faces, RWG edges, directions, phase span and
  point-direction work. It reports quadrature change and `not_validated` model
  status. Failed convergence withholds RCS. It computes neither finite-range
  fields nor a current distribution and does not establish surface geometry or
  charge-continuity validity beyond the supplied RWG topology.
- Release of a surface solver requires singular/adjacent/disjoint-near
  **double** integrals, EFIE assembly, an incident-wave solve, quadrature and
  mesh convergence, reciprocity, passive radiation/optical-theorem checks,
  sphere/Mie comparisons, independent solver and measured fixtures, resource
  qualification, and knowledgeable human numerical review. Low-frequency,
  dense-mesh and interior-resonance conditioning require separate work.
- [Plane-wave density interpolation](https://arxiv.org/abs/1910.02046) and
  [OSRC preconditioning](https://arxiv.org/abs/2507.20707) are research
  candidates only. Their published accuracy or performance is not attributed
  to this implementation.
