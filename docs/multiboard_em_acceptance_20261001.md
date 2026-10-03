# Multi-board EM and SI execution evidence, 2026-10-01

Evidence root: `build/multiboard-acceptance-20261001/em`.
These are executed numerical examples with explicit scope limits. They do not
qualify complete imported multi-board electromagnetic assemblies for release.

## Actual four-excitation field run

Configured local OpenEMS 0.0.36 executed four independent excitations for two
substrates, signal traces and separate returns with 4 mm air separation.
Each excitation had 69,264 Cartesian FDTD cells. The 101 frequency points span
0.2–3 GHz. All four runs completed their pulse and achieved the requested
1e-7 energy criterion (at least 70 dB decay). No timeout or output quota occurred.

Command:

```powershell
.venv\Scripts\python.exe scripts/multiboard_em_acceptance.py --output build/multiboard-acceptance-20261001/em/box-field-extension-source --timeout 300
.venv\Scripts\python.exe scripts/multiboard_em_acceptance_interference.py build/multiboard-acceptance-20261001/em/box-field-extension-source
```

Elapsed external execution was 253.165 seconds. Maximum S singular value was
1.000247697 and maximum absolute reciprocity error was 0.003270629; these pass
the existing explicit 0.02 sanity thresholds. Cross-board |S31| peaked at
0.229549215. With an explicit 50 ohm Thevenin source and 50 ohm terminations,
loaded NEXT/FEXT voltage transfer peaks were 0.114774607 and 0.110303565 V/V.
The frequency band lacks DC, so the loaded result remains frequency-only.
Board B port polarity remains +z, opposite its signal-to-return polarity;
no phase/sign repair or passivity projection was applied.

Raw `geometry.xml`, port voltage/current files, `solver.log`, `field-result.json`,
`execution.json`, and hash-bound `screening.json` are retained. The downstream
`field-network.s4p` and `loaded-field-crosstalk.json` preserve the complete
four-port solution and source result digest.

The original `scripts/run_crossboard_openems.py` attempt failed before FDTD:
its concatenated Python source now includes a compatibility shim that cannot
import `extensions` in the isolated stdin runtime. Failure logs remain under
`box-field`. The acceptance runner snapshots the actual extension implementation
and uses the existing benchmark worker without changing the production adapter.

**Validity limits:** synthetic exact boxes, not imported PCB copper polygons,
vias, components, connectors, or harness geometry. One mesh/PML/duration setting
was executed; numerical sanity is not convergence or measured qualification.
Copper loss is not skin-depth resolved. The field runtime is available, while
complete retained AssemblyIR-to-full-board EM lowering remains unsupported.

## Actual source-derived two-occurrence SI graph

Command:

```powershell
.venv\Scripts\python.exe scripts/multiboard_em_acceptance_si.py --output build/multiboard-acceptance-20261001/em/esp32-source-si-graph
```

The existing pinned ESP32 KiCad recipe extracts the exact 0.7874 mm parallel
ERXD0/ERXD1 overlap and its imported In1.Cu reference. Sparse finite-difference
cross-section extraction supplies coupled R/L/C matrices. A graph connects two
occurrences of that extracted four-port model through an explicitly authored
10 mm connector RLGC model (synthetic properties, no connector extraction).
Source board digest and selected geometry are preserved in `source-slice.json`
and `report.json`; extraction matrices and mesh-level evidence are retained in
`extraction.json`.

Execution completed in 1.320 seconds. Latest relative capacitance-matrix change
was 0.010136239 between cross-section mesh levels. Maximum graph S singular
value was 1.0000000000036382 and absolute reciprocity error was 5.2425e-13.
With the explicit 3.3 V Thevenin pulse and 50 ohm port terminations, loaded
NEXT peaked at 5.252851 mV and FEXT at 3.472685 mV. Loaded time-domain execution
completed. `graph.s4p`, `graph.json`, and `loaded-crosstalk.json` are saved.

This is actual source-derived parasitic extraction plus coupled network
execution. It excludes the remainder of the original routes, their bends,
vias, full boards, launch/connector extraction, and spatial interaction between
the board occurrences. The graph's paired zero-length port bonds express
authored reference-plane assertions. It does not claim full-assembly fields.

## Analytical network references

Existing `benchmark_si_network_graph.py` and `benchmark_si_multiboard.py`
were also executed under `si-network-graph` and `si-two-port-chain`.
The coupled four-port synthetic graph matched its independent equivalent line
within 1.5101e-15 complex S and reciprocity within 1.6653e-15. The two-port
lossless chain matched its 0.4 ns delay reference within 1.0825e-15. These
confirm composition algebra; they do not qualify board geometry or EMI.

`scripts/check_architecture.py` passed after adding these validation runners.
No production solver, UI, viewport, service, or thermal code was changed here.
