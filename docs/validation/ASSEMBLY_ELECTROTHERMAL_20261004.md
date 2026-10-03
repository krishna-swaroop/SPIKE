<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 SigHarmonic -->
# Assembly electrothermal validation

Windows local development checks on October 4, 2026 used the project Python
environment with warnings treated as errors. No external device/measurement
dataset was imported. This record is not production or full-suite qualification.

## Reproduction

```powershell
.venv/Scripts/python.exe -W error -m unittest tests.python.test_assembly_electrothermal tests.python.test_electrical_heat_sources tests.python.test_assembly_tetra_electrical tests.python.test_assembly_tetra_thermal tests.python.test_assembly_field_handoff tests.python.test_assembly_field_geometry tests.python.test_assembly_field_admission_review tests.python.test_structured_electrothermal tests.python.test_transient_diode_field
.venv/Scripts/python.exe scripts/check_architecture.py
.venv/Scripts/python.exe -W error examples/assembly_field/run_electrothermal.py
```

The final combined run passed 84 tests in 12.549 seconds. Architecture checks and all
three guided coupled examples passed. Schema validation and actual JSON worker
execution are included. An initial combined invocation exposed a test-helper
import depending on discovery mode; its qualified package import was fixed
before this successful combined run.

## Numerical evidence

The analytic two-volume bond fixture gives 1.6 A, 3.2 W and 0.64 W contact heat.
The guided constant-conductivity run reports electrical imbalance
`-1.3322676295501878e-15 W` and thermal imbalance
`3.952393967665557e-14 W`. Temperature feedback gives 2.758368140485217 W;
the synthetic switching table increases total deposition to 4.153186308920882 W.
All three runs converge in 13 iterations at the declared temperature/power gates.

For conductivity `sigma=1+x`, potential `log(1+x)/log(2)`, four refinement levels
give centroid RMS errors 0.072300, 0.020309, 0.009335 and 0.005326.
Source power approaches the exact 1.442695041 W from 1.5, 1.458274,
1.449771 and 1.446710 W. This is a bounded manufactured test, not arbitrary
PCB convergence qualification. Loss unit tests independently verify quadratic
waveform energy 7.5 J, spectral heat 145 W and interpolated device-table values.

Malformed/overlapping/hanging geometry, implicit welding, dielectric nodes,
ill-conditioning, material-law overflow, unsupported links, loss-model bounds,
one-ULP negative waveform intervals, cancellation and nonconvergence are tested.
Independent agent reviews checked conservative coupling and prompted finite
denominator and normalized temperature-sampling hardening. Human numerical
review, measured correlation and the broader release gates remain open.

## Full suite findings

The broader `-W error -m unittest discover -s tests/python` run completed
2,569 tests in 453.184 seconds: one failure, three errors and 13 skips.
The failure is the existing public-release readiness expectation for
`PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED`. Two errors were SQLite model
cache access outside this task's managed writable roots. Both pass with a
temporary writable `SPIKE_MODEL_INDEX_PATH`. The third error was an MCAD
archival `analyses.latest_result` KeyError; that test passes individually in
the concurrently edited workspace, which does not establish a permanent fix.
The readiness assertion still fails individually. No acceptance requirement
or policy was relaxed. Full-suite qualification remains not green.

The authorized SPIKE assembly integration task received the verified worker
contracts and these actionable failures. It reports the prior thermal-only
GUI integration complete; the new coupled record still requires separate UI
and stale-result persistence integration. Notification is not deployment proof.
