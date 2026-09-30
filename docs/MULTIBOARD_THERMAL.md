# Coupled multi-board thermal RC analysis

`run_multiboard_thermal` accepts `spike/multiboard-thermal-request/v1` and solves
one conductance network for all retained board occurrences. A heated board can
raise another board's temperature through an explicit retained thermal contact.
This is an **approximate engineering precheck**, not a geometry-derived field,
airflow calculation, radiation solve, or thermal sign-off.

Supply one `board_models` entry for every assembly board, with `board_id`,
`elements`, and optional `links`. Elements and links use the existing
[thermal-network properties](COMPONENT_THERMAL.md). Element IDs are local to a
board occurrence; repeated PCB designs and repeated local IDs remain distinct.
Links use `from_id`/`to_id`; `ambient` is the common fixed sink. Supply power in
W, ambient resistance in K/W, and transient heat capacity in J/K. Connector or
harness losses can be added explicitly as node power after reviewing their
thermal allocation. Electrical loss is not mapped automatically.

Every retained `assembly.thermal_contacts` entry requires one `contact_models`
entry: `contact_id`, `from: {board_id,node}`, `to: {board_id,node}`, and positive
`conductance_w_per_k`. Model orientation must agree with the retained contact;
each endpoint must name its retained board occurrence or start with its ID and
a colon. This adapter admits contacts between different boards only. Contacts
to enclosures/parts require another model and are rejected. No contact is
inferred from board separation, connector name, material, or mechanical overlap.

`mode` defaults to `steady_state`. Transient mode requires positive
`time_step_s` and `duration_s`. Every transient element needs positive
`thermal_capacitance_j_per_c`; its default initial temperature is ambient.
Every node needs an explicit network path to ambient. Invalid identities or
physical parameters raise `MultiboardThermalError`; missing ambient paths or
capacities return a blocked result with diagnostics and no temperatures.

## Result and persistence boundary

The result contract is `spike/multiboard-thermal-result/v1`. It includes
`assembly_id`, `assembly_digest`, `status`, `model_status`, `coupled_physics`,
occurrence-tagged `nodes`, `board_temperatures_c` indexed by board and local
node, `transient` frames, and `contact_heat_flows`. Positive contact heat flow
means from the supplied `from` endpoint toward `to`. `steady_heat_flow_w`
describes the steady equilibrium; `heat_flow_w` describes the final transient
sample or the steady solution. Summary energy and node residuals describe the
steady equilibrium even when transient mode is selected. Provenance records
the complete request digest, retained occurrence/contact IDs, and assumptions.
The assembly digest excludes saved study outputs so saving results does not
change the physical model identity.

## Derivation, conditioning, and validation

For each node, conservation gives
`C_i dT_i/dt + sum_j G_ij(T_i-T_j) + G_i,ambient(T_i-Tambient) = P_i`.
Each reciprocal positive contact adds `+G` to the two diagonal matrix entries
and `-G` to the two off-diagonal entries. With every connected component
anchored to ambient, the conductance matrix is positive definite. The existing
partial-pivot dense thermal kernel solves the steady system and backward Euler
transients. Parameters are constant. Celsius and kelvin temperature differences
have identical magnitudes; no conversion is needed for K/W or J/K.

Extreme conductance ratios can make the dense system ill-conditioned. Singular
systems fail explicitly. The adapter checks finite JSON results and rejects a
steady node energy residual greater than `1e-8 * max(1,total_power_w)` W.
Reduce the transient time step and compare temperatures for discretization
convergence. Backward Euler is stable for this passive RC model but is first
order in time and can underresolve fast thermal dynamics.

`tests/python/test_multiboard_thermal.py` contains an independently derived
two-board reference: both boards have 1 W/K ambient conductance, their mutual
contact is 1 W/K, and powers are 10 W and 0 W. The matrix is
`[[2,-1],[-1,2]]`; rises are `20/3` K and `10/3` K, and contact heat flow is
`10/3` W. Tests verify these values, conductance sensitivity, per-node energy
conservation, repeated-design isolation, local links, and malformed inputs.
For unit capacitances, independent eigenmodes have rates 1 and 3 per second;
the analytical exponential oracle verifies decreasing errors at time steps
0.1, 0.05, and 0.025 s and transient storage/ambient balance. This algebra and
the fixtures are original SPIKE work, derived independently from conservation;
no external implementation was used. Knowledgeable human numerical review is
required before release.

Resource limits: 30 board occurrences, 256 total nodes, 8192 explicit links,
10,000 transient steps, and `steps * nodes^3 <= 50,000,000` dense work units.
These protect the worker, not a claim of field-solver accuracy.
