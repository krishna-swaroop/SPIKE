<!-- SPDX-License-Identifier: Apache-2.0 -->
# EMerge antenna / Optycal STEP reflector execution

This example uses the original SPIKE Apache-2.0 patch PCB at
`examples/emerge/antenna_example.kicad_pcb`, its actually solved EMerge
3.0.0a19 3.4 GHz complex angular samples and recorded P1 unit-coefficient
excitation, and an original SPIKE-owned 500 x 500 x 5 mm PEC STEP plate.
The plate is placed 1000 mm along world Z from the explicitly assumed source
phase origin. The source model uses a declared 100 mm antenna aperture,
100 m observation sphere and 15-degree theta / 30-degree phi samples.

The study was actually executed through Optycal 0.2.0, not simulated by plotting
synthetic fields. `admitted_result.json` passed SPIKE admission. The saved
`study.py` was previewed before solving and its SHA-256 equals executed
provenance. `execution_manifest.json` records UTC times and source/script/STEP
digests. The independently tessellated structure has 2046 triangles at 25 mm;
944 outward triangles face the source. There are 169 observation directions.

`report.html` uses the same renderer as the desktop GUI. It retains the full
returned evidence and displays common-reference patterns and interference.
`comparison_interference.png` and `structure_patterns.png` are static plots
of actual returned samples. `probe.json` contains a real angular observation.

Open `viewport_example.spike` in SPIKE to inspect the solved patch and installed
antenna studies in the main PCB viewport. The EM results manager selects bare,
scattered and installed fields, pattern changes and interference; it also
exposes solved E/H planes, probes and graphs. The plate mesh uses its returned
solver coordinates. Rebuild the project after regenerating results:

```powershell
cd app
node scripts/build-em-viewport-example.mjs
```

Far-field spheres encode direction and relative amplitude with a user-selected
display radius. They are not spatial fields at that radius. Node and antinode
candidates are sampled amplitude thresholds.

Run from the repository root after installing the separate optional engines
and ordinary frontend dependencies:

```powershell
.venv-emerge3/Scripts/python.exe examples/optycal/run_structure_study.py --acknowledge-phase-assumption
.venv-emerge3/Scripts/python.exe examples/optycal/run_structure_study.py --acknowledge-phase-assumption --mesh-size-mm 12.5 --output examples/optycal/refinement
```

The explicit flag acknowledges that source coefficients use e^(+j omega t)
with phase origin at the placed antenna origin. It does not establish absolute
field calibration. `--render-only` regenerates plots and the shared report
without solving. The saved script can independently generate raw Optycal data:

```powershell
.venv-emerge3/Scripts/python.exe examples/optycal/study.py --result raw.json
```

The actual 12.5 mm repeat has 8060 triangles. At the same 169 angular
observations, the complex installed-field L2 difference relative to the fine
field is 0.00465 (0.465%); the largest sampled installed-amplitude dB difference
is 0.589 dB. The scattered-field L2 difference is 1.623%, and the maximum
pointwise complex difference divided by the bare field peak is 0.881%.
This is one mesh refinement comparison, not mesh/angular convergence or
measurement validation. `mesh_comparison.json` records it.

All results remain unvalidated. PO omits geometric shadowing, diffraction,
multiple scattering, antenna loading and loss. A nearby enclosure or dielectric
radome requires a suitable full-wave model. These execution plots must not be
interpreted as calibrated compliance, gain, efficiency or hardware predictions.
See the adapter README for assumptions, public API provenance, bounds, recovery
and independent normalization/phase oracle checks. Source and generated assets
in this directory are Apache-2.0; separately installed engines keep their own
licenses.
