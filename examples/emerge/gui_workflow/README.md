<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fresh EMerge board execution examples

These outputs were generated with the separately installed EMerge 3.0.0a19
runtime on 2026-09-30. `execution_manifest.json` records result file timestamps,
SHA-256 digests, SPIKE design bindings and explicit host admission checks.
Each `*_simulation.py` is saved from the public GUI model-preview operation
before execution. The report generator verifies that its SHA-256 matches
`provenance.generated_script_sha256` in the solved result. The generated script
contains SPIKE-owned adapter code and the admitted case, not upstream solver
implementation. It can run directly with the selected EMerge interpreter:

```powershell
.venv-emerge3/Scripts/python.exe examples/emerge/gui_workflow/patch_simulation.py --result patch_raw.json
```

This direct command yields the engine's raw output. Use the example runner for
normalized and host-admitted SPIKE result envelopes.
`report.html` is an offline report with S11, radiation cuts, sampled 3D spheres,
complex electric-field angular probes, provenance and model warnings.

Run from the repository root:

```powershell
.venv-emerge3/Scripts/python.exe scripts/run_emerge_gui_examples.py
```

To regenerate only plots/report from saved solver data:

```powershell
.venv-emerge3/Scripts/python.exe scripts/run_emerge_gui_examples.py --render-only
```

Examples:

- `patch`: original SPIKE-owned Apache-2.0 KiCad patch board,
  `examples/emerge/antenna_example.kicad_pcb`; 3.0–4.2 GHz, seven points,
  requested 2 mm mesh.
- `radome`: original SPIKE-owned Apache-2.0 KiCad patch fixture with explicit
  50 × 40 × 1.5 mm lossless dielectric slab 10 mm above the board;
  `examples/emerge/radome/antenna_with_radome_run.json`; same sweep and mesh.
- `esp32_surrogate`: uysan's open-source `iot-esp-eth` source board,
  CERN-OHL-P-2.0, pinned under `examples/esp32/source/`. Retain its license,
  source and attribution. See `examples/esp32/README.md` and
  `THIRD_PARTY_NOTICES.md` for source revision and terms. Uses 2.3–2.6 GHz,
  three points, requested 1.5 mm mesh. The four-layer source is reduced to an
  explicitly disclosed two-conductor RF surrogate. Read the generated
  `esp32_surrogate_assumptions.json` for every omission. This is not a full-board
  simulation or a prediction of the physical ESP32 assembly.
- `patch_fields`: an additional 3.4–3.6 GHz two-point patch run with the
  imported dielectric's constant loss tangent enabled and an 11 × 11
  near-field plane 1 mm above copper. `patch_fields_nearfield.png` maps actual
  solved complex E/H magnitudes; `patch_fields_nearfield_probe.json` records
  the largest valid sampled E location and its three complex E/H components.
  This has different physics from the bare/radome comparison; compare the
  `patch` and `radome` datasets with each other instead.

All runs completed and passed SPIKE's analysis-result admission checks. The
raw and admitted JSON files retain S-parameters, radiation angular arrays and
complex E-theta/E-phi components. Probe JSON records an actual peak sample of
the first frequency's angular grid. Spheres use normalized E amplitude and
show only that same frequency; cuts show the sweep's phi=0 plane. Pole phi
values are degenerate coordinates and should not be interpreted as a unique
azimuthal direction. The plots are derived only from these solver arrays.

All model statuses remain **unvalidated**. There is no mesh convergence,
measurement correlation, efficiency, calibrated realized gain or compliance
claim. Conductors are PEC. Dielectric loss is omitted for the three comparison
and surrogate runs; `patch_fields` represents constant imported loss tangent
and still omits copper loss and frequency-dependent material dispersion.
Preserve warnings and source attribution when sharing these results.
