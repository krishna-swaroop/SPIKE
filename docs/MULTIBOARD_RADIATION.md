# Radiation and standoff cross-heating between boards

`run_multiboard_thermal` can solve both operating boards in one nonlinear
thermal RC network with radiation and retained standoff contacts. Add
`radiation_surfaces` to `spike/multiboard-thermal-request/v1`. Each entry is
one opaque isothermal diffuse-gray surface:

```json
{
  "id": "lower-facing-upper",
  "board_id": "lower",
  "node": "board",
  "area_mm2": 10000,
  "emissivity": 0.8,
  "view_factors": {"upper-facing-lower": 0.8, "ambient": 0.2}
}
```

Provide the corresponding upper surface, its area and reciprocal view factor.
All surface IDs and node references must exist. Every view-factor row must
sum to one within 1e-10. Pairwise area reciprocity `Ai Fij = Aj Fji` must hold
within `1e-10 * max(Ai,Aj)` square meters. Factors are finite in [0,1]; missing
surface entries mean zero. The remaining ambient factor must be supplied
explicitly. No factor is silently inferred from board spacing, occlusion,
outline, or stack placement. Emissivity must be in (0,1]; perfect mirrors are
unsupported. Ambient is a fixed black surrounding, at the thermal request's
ambient temperature.

Standoffs use retained `assembly.thermal_contacts` with reviewed
`contact_models.conductance_w_per_k`. For a uniform cylindrical post,
`G = 1/(L/(k A) + Rcontact_a + Rcontact_b)` in W/K, with area and length in
SI units. Several independent posts contribute parallel conductances. This
relation does not extract contact resistance, spreading resistance or material
properties. Use one retained contact per physical post or explicitly review an
aggregate equivalent. Both boards' component and copper dissipation must be
supplied as node power. A DC operating-point loss total may seed that power
only after explicit board-occurrence and thermal-node allocation.

Each surface can instead use `part_id` for a casing or other physical part;
exactly one owner key is permitted. Every node needs an explicit conduction or
radiation path to ambient. A purely radiative assembly is admitted when supplied
view-factor rows connect it to ambient; a fully closed floating enclosure is
blocked. Radiation-only coupling is admitted without standoff contacts when at
least one positive view factor connects different board/part occurrences. Contact coverage
remains exact when retained contacts exist.

## Formulation and validity

For surface i, `Ji = ei sigma Ti^4 + (1-ei) Hi`, where radiosity J and
irradiation H are W/m2, `Hi = sum_j Fij Jj + Fi,ambient Jambient`, and
`Jambient = sigma Tambient^4`. Temperature is absolute kelvin in these
equations; the public input remains Celsius. Surface heat leaving the node is
`Qi = Ai (Ji-Hi)` in W. The bounded radiosity matrix is solved using the
existing partial-pivot thermal linear kernel. Its inverse is computed once
for constant view factors and emissivities.

The board balance combines these surface flows, reciprocal standoff
conductance, board links, ambient links, dissipation, and RC storage. Damped
Newton solves the nonlinear balance using the exact radiosity temperature
Jacobian. Transients use backward Euler; reduce the time step and compare.
Radiation pair exchange is `Ai Fij (Ji-Jj)` and is equal/opposite across the
pair. View-factor reciprocity makes internal exchange cancel from total
energy balance. Surface power to ambient is accounted separately. The model
contains multiple reflections; applying a simple emissivity multiplier to
each pair would omit those reflections.

Method provenance: [COMSOL's diffuse-gray radiosity theory](https://doc.comsol.com/6.4/doc/com.comsol.help.heat/heat_ug_theory.07.054.html)
describes emission, irradiation and reflected radiosity;
[the view-factor reciprocity relation](https://www.comsol.com/blogs/introduction-to-computing-radiative-heat-exchange/)
provides the conservation invariant. SPIKE's derivation, data structures,
Jacobian, fixtures and code were authored independently from these equations.
No external implementation was consulted or copied.

This is an approximate uniform-surface model. It does not solve board spreading
fields, angular/specular reflection, wavelength dependence, transparent media,
airflow, or geometry-derived visibility. Material and view-factor uncertainty
are not removed by a converged numerical solution. Very small emissivities,
extreme conductance ratios or extreme temperatures can be ill-conditioned;
singular, nonfinite or unconverged systems fail explicitly. Newton uses an
80-iteration limit and relative heat residual tolerance 1e-10. Final steady
node conservation must also pass the existing `1e-8 * max(1,total_power_w)` W
gate. A 50,000,000 work-unit limit bounds matrix construction/factorizations;
at most 64 radiation surfaces are admitted. Knowledgeable human numerical
review remains required before release.

## Outputs and verification

Results retain the existing assembly and request digests. `radiation_surfaces`
reports radiosity, final `net_heat_flow_w`, and `steady_net_heat_flow_w`.
`radiation_exchange` reports `surface_a`, `surface_b`, `heat_flow_w` at the
final transient time (or steady state), and `steady_heat_flow_w`. Positive pair
flow is from a to b. `radiation_node_heat_w` is the steady radiation balance
per namespaced node. Summary includes ambient radiation power, radiation
closure residual, maximum transient heat-balance error, Newton iteration
count, and work units. Existing contact flows show standoff conduction.

`tests/python/test_multiboard_radiation.py` independently checks:

- Two infinite parallel diffuse-gray surfaces against the scalar resistance
  expression `Q = sigma A (Ta^4-Tb^4)/(1/ea+1/eb-1)`.
- Two powered boards (8 W and 2 W), each with 0.1 W/K ambient conductance,
  a 0.01 W/K standoff and 0.01 m2 black facing surfaces. Explicit ideal closed
  view factors are 1. These are mathematical reference inputs, not extracted
  properties of an imported PCB. Temperatures are 84.628580204 C and
  65.371419796 C; radiation transfers 1.844570376 W and the standoff transfers
  0.192571604 W. An independent scalar bisection oracle checks temperatures.
- Removal of radiation, zero inter-board view factors, both-board power
  sensitivity, unequal-area reciprocity, open ambient closure, malformed
  factors, and unknown nodes.
- First-order transient refinement against a separate adaptive ODE solver.
  Halving time steps from 0.2 to 0.1 to 0.05 s decreases temperature error.
- Uniform panel subdivision invariance and an independently evaluated central
  finite-difference check of the analytic radiosity Jacobian.

These checks validate the bounded numerical model, not the physical view
factors or complete temperature field of a real board stack.
