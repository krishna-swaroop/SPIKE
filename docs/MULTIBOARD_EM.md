<!-- SPDX-License-Identifier: Apache-2.0 -->
# Assembly magnetic-loop coupling

`run_multiboard_em` accepts `spike/multiboard-em-request/v1`, with AssemblyIR,
2..128 explicit closed `loops`, 1..4096 increasing positive `frequency_hz`,
`mutual_inductances`, and `connector_models`. Every retained board/physical part must own at
least one loop. The solver does not derive loops or inductance from artwork.
Each loop has unique `loop_id`, either `board_id` or `part_id`, positive `resistance_ohm`, positive
`self_inductance_h`, signed `voltage_real_v` and `voltage_imag_v` RMS phasors.
Each mutual entry gives `loop_a`, `loop_b`, signed `mutual_inductance_h`; omitted
pairs mean zero coupling. Duplicate/reversed pairs and unknown owners fail.
Contacts identify `loop_id`, `board_id`, `connector_id`, `pin`, nonnegative
`resistance_ohm`, `inductance_h`; each contact must own a unique retained pin.
Contacts add to that loop's series R/L; they do not establish a new conductor
between unrelated loops. Use the shared circuit workflow for conductive links.

## Independently derived model

With RMS phasors, each loop obeys
`V_i = R_i I_i + j omega sum_j L_ij I_j`. Reciprocal magnetic coupling gives
`L_ij=L_ji`; magnetic energy `0.5 i^T L i` requires a positive semidefinite
L matrix. The implementation stamps a symmetric matrix, checks its normalized
minimum energy eigenvalue (tolerance -1e-12), then solves
`(diag(R) + j 2 pi f L) I = V`. Positive R provides dissipation. RMS real
power is `real(I^H V)=sum_i R_i |I_i|^2`, with no peak-phasor factor 1/2.
Signed mutual inductance includes the chosen loop orientation/dot convention.
Method reference: [MIT coupled-coil circuit lecture](https://circuits.mit.edu/_static/S24/handouts/lec14a/lec26.pdf).
Implementation, derivation and fixture data were independently authored; no
external implementation or test data was copied.

The matrix condition must remain <=1e12 and relative linear residual <=1e-9.
Dense work is bounded by points * loops^3 <=100 million, input <=8 MiB.
No iterative or mesh discretization is used: frequency points are separate
algebraic solutions, not an accuracy convergence argument for the supplied
physical model. Constant R/L is valid only over its independently established
quasi-static band. Board movement requires re-extracting the supplied model.

The result `spike/multiboard-em-result/v1` retains currents per frequency and
occurrence, resistive losses, power balance, conditioning, linear residual,
minimum energy eigenvalue, assembly and request digests. `coupling_included`
is true only for nonzero mutual terms across distinct board/part owners.
`field_coupling_executed=false`; production_qualified=false.

The two-loop regression independently evaluates
`I_B = -j omega M V_A / ((R_A+j omega L_A)(R_B+j omega L_B)-(j omega M)^2)`.
It checks induced current, zero-mutual isolation, reciprocity, contact sensitivity,
power conservation and rejection of nonpassive models. It is not physical
validation of geometry extraction. Electric fields, displacement currents,
radiation, enclosure/shielding, skin-effect extraction and EMI compliance are
outside this model. Retained parts and bonds are not automatically stamped;
their effect must be included in the supplied loop reduction.

## Conductive mechanical structure loops

Loops now require exactly one owner: `board_id` or `part_id`. Supply explicit
R/L and RMS drive for every physical part as well as every board. Casings and
shields can have passive induced-current loops with zero applied drive. A board
plus a physical part is admitted. Model-less subassembly containers are listed
in `excluded_hierarchy_part_ids`; they do not acquire a fabricated loop.
The result loop retains its typed owner. Existing reciprocity, inductance energy
and power-balance checks apply unchanged. Board connector contacts cannot be
assigned to a part loop. Retained electrical bonds and rigid-flex links are
rejected by this reduction because its independent loops do not stamp their
topology. Use the circuit path for explicit bonds.

This accounts for an authored magnetic loop equivalent of the structure.
General casing shielding, dielectric loading, mesh geometry and full-wave
assembly fields require a field solver adapter and separate validation.
