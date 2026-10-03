<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Coupled assembly electrothermal analysis

The experimental worker solves steady DC electrical conduction and solid heat
conduction on supplied conforming tetrahedral volumes, including multiple board
occurrences and explicitly matched resistive bonds. Temperature changes bulk
conductivity and supplied semiconductor loss tables. This is executable coupling,
not general PCB CAD extraction or universal semiconductor coverage.

## Run the example

From the repository root run:

```powershell
.venv/Scripts/python.exe -W error examples/assembly_field/run_electrothermal.py
```

The example builds original synthetic one metre slabs, not a measured PCB.
It prints input/result digests, power, occurrence temperatures and convergence.
Two 0.5 ohm volumes and a 0.25 ohm bond at 2 V give 1.6 A, 3.2 W total heat
and 0.64 W contact heat. Further runs demonstrate temperature feedback and a
synthetic switching-loss table. These materials are not real device data.

## Worker inputs and coupling

Call `run_assembly_electrothermal` with exactly `{request}` through
`python.spike_core.service`. The contract is
`spike/assembly-electrothermal-request/v1`; see
`../schemas/assembly-electrothermal-request-v1.schema.json`.
Supply retained thermal geometry/problem, electrical materials, occurrence-scoped
terminal faces, matched face pairs for every electrical bond, a nonoverlapping
loss inventory and explicit iteration limits. Semantic decoders additionally
check geometry, topology, ownership, finite values and resource budgets.

Conductivity obeys `sigma(T) = sigma_ref / (1 + alpha * (T - T_ref))`.
The temperature envelope applies to cell mean temperature, not peak nodes;
the denominator must be finite and positive throughout the envelope.
Retained bond area/resistance must agree with the contact model. Bulk Joule
heat and half each contact loss on each side are deposited exactly once.
Only compiled electrical bonds are removed from the nested thermal-only
adapter; the original complete request and assembly remain hash-bound.
Unrepresented harness, connector and rigid-flex connectivity is rejected.

The fixed-point loop checks unrelaxed temperature defect and L1 electrical
power change; relaxation cannot mask failure. The nested final thermal result
used the preceding load: `coupled_power_defect_w` reports the bounded remaining
difference. Background thermal sources enter the thermal solve but not the
electrical-only `cell_deposited_power_w`. Results include conservation, history
and integrity hashes. Cancellation is polled between phases, not OS-enforced.

## Heating sources

Call `evaluate_electrical_heat_source` with exactly `{request, temperature_k}`.
The `spike/electrical-heat-source/v1` contract supports:

- Dissipative terminal waveforms: exactly integrate the product of piecewise
  linear voltage/current and reject negative-power intervals. Stored energy
  must already be separated from dissipative terminal power.
- Orthogonal RMS spectral currents and frequency-specific resistance:
  sum `I_rms^2 R`; this does not extract broadband field currents.
- Temperature-indexed conduction power and nonoverlapping turn-on, turn-off
  and recovery energies: interpolate within range, then add switching frequency
  times event energy. No extrapolation or universal device inference.

Occurrence/cell weights must sum to one. Feedback uses their normalized weighted
mean temperature; deposition preserves supplied weights. Provenance and energy
nonoverlap are caller declarations, not independently authenticated data.
These sources provide averaged steady heat, not switching circuit transients.

## Validation and remaining scope

On 2026-10-04, 84 focused tests passed with Python warnings treated as errors:
electrical/thermal tetra kernels, retained assembly admission, coupled analysis,
heating models and existing structured/diode electrothermal regressions. Coverage
includes four-grid manufactured convergence, analytical contact resistance,
conservation, temperature feedback, malformed geometry and conditioning failures,
strict schema validation and the actual JSON worker subprocess.

General PCB CAD volume generation, arbitrary semiconductor subcircuits, transient
coupling, radiation/airflow, independent/measured correlation and desktop coupled
study integration remain open. This is not full-suite or production qualification.
A finite device/model operating-range corpus and knowledgeable numerical review
are required before claiming semiconductor or release qualification.

## Method provenance

Operators, contact deposition, coupling and loss integration were independently
derived and authored here; no external implementation, netlist or measured data
was copied. Contextual references describe applicability, not code validation:
[ngspice electrothermal tutorial](https://ngspice.sourceforge.io/ngspice-electrothermal-tutorial.html)
and [Infineon switching loss guidance](https://community.infineon.com/t5/Knowledge-Base-Articles/Estimating-SiC-MOSFET-switching-losses-in-applications/ta-p/709113).
