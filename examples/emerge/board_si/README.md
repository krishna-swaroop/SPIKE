# Marble and White Rabbit EMerge SI experiments

The reproducible runner is `scripts/run_emerge_board_si.py`; the report builder
is `scripts/render_emerge_si_reports.py`. Local source fixtures and their derived
geometry/results remain under `build/emerge-si`, rather than redistributing the
CERN-OHL board sources. The selection record binds both boards to their SHA-256.

The Marble v1.4.4 experiment retains the shared 18.456108 mm straight portion of
FMC2_DP0_C2M_N/P, with 0.13 mm width and 0.20 mm edge gap. Its KiCad stackup supplies
0.105454 mm dielectric, relative permittivity 4.5 and loss tangent 0.02.
The White Rabbit SCB experiment retains 5.55165 mm of SYNC_DATA_P/N, with 0.10 mm
width and 0.26501 mm edge gap. The original pinned Altium board records supply
0.06500114 mm Top-to-GND1 dielectric and relative permittivity 4.6; no loss tangent
was recorded, so lossless dielectric is an explicit assumption.

These are separate local four-port models with ideal continuous reference planes
and synthetic vertical terminals. The rest of each route, devices, vias, plane
voids, other copper layers, copper loss, roughness, solder mask and dielectric
dispersion are omitted. They are not complete-board or qualified PHY models.

```powershell
.venv-emerge3/Scripts/python.exe scripts/run_emerge_board_si.py --prepare-only
.venv-emerge3/Scripts/python.exe scripts/run_emerge_board_si.py
.venv/Scripts/python.exe scripts/render_emerge_si_reports.py --output build/emerge-si
```

The runner needs the existing inspected `build/emerge-si/selection.json` and
original local source fixtures. Its source hashes and section containment checks
reject changed files or endpoints that leave their original track segments.
The saved Python preview is SHA-256 bound to the executed source. Every result
passes SPIKE host admission against the exact reduced design digest.

The SI sweep contains 64 actual FEM samples from 100 MHz through 6.4 GHz. Original
complex values are retained in JSON, CSV and Touchstone. The report contains
reflection, through transmission, conductor coupling (NEXT/FEXT diagnostics),
differential transmission, mode conversion and a sampled E/H plane.

The selected conductors are differential pairs. Independent PRBS aggressor/victim
excitation is a single-ended diagnostic, not normal differential signaling.
Differential waves use D=A−B: Marble N−P and White Rabbit P−N. The differential
scenario uses 100-ohm differential and matched 25-ohm common-mode terminations.

For equal 50-ohm physical references, the independently authored wave conversion
is `a_D=(a_A-a_B)/sqrt(2)` and `a_C=(a_A+a_B)/sqrt(2)`, applied at both ends.
The orthonormal matrix `T` gives `S_modal=T S T^T`, with condition number one.
Using `V_D=V_A-V_B`, `I_D=(I_A-I_B)/2`, `V_C=(V_A+V_B)/2`, and `I_C=I_A+I_B`
gives differential reference `2 Z0` and common reference `Z0/2`. The two-port
differential block assumes matched common-mode ports, so their incident waves
are zero; it does not discard reflected common-mode feedback from arbitrary
loads. Unequal physical references are rejected by the eye scenario. Ideal
disjoint-through and zero-conversion oracles check this conversion and matched
half-voltage receiver response. No external implementation was copied.

EMerge supplies no DC sample in these runs. Eye and time-interference plots are
separate, explicitly **DC-assumed** scenarios: an ideal disjoint PEC through
matrix is appended at DC, leaving all FEM samples untouched. They use 500 Mb/s
PRBS7, 150 ps edges and ideal matched endpoint models. No actual device voltage,
receiver threshold, jitter, BER, compliance, measurement correlation or mesh/time
convergence is inferred. Material sampled passivity failure blocks the eyes;
smaller passivity/reciprocity deviations are reported without repair.

Open `build/emerge-si/report.html` for the resulting plots, assumptions, source
records, numerical checks and links to raw data. Results remain **unvalidated**.
