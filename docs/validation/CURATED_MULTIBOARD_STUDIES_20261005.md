# Curated multi-board studies, 2026-10-05

## Delivered examples

See the [curated example index](../../examples/multiboard/README.md) for build
commands and separate desktop walkthroughs. Fresh local packages are:

- `build/curated-multiboard-20261005/arduino/arduino-r4-relay-shield.spike`
- `build/curated-multiboard-20261005/raspberry-pi/cm4io-sailor-hat.spike`

Each contains two distinct retained source designs, occurrence placements,
explicit connector mates, and saved PI, SI and Thermal setups with completed
results. The Raspberry Pi assembly is the CM4 IO carrier and Sailor Hat, not
an SBC or a model of the Compute Module CPU.

## Actual execution evidence

Both builders ran against locally cached, pinned CAD inputs. The separate
`scripts/verify_curated_multiboard_worker.py` run exercised the JSON-line
desktop worker for all six studies. Every result exactly matched its result
sidecar. Worker project opening hydrated all six retained results; each matched
its sidecar and passed `validate_multiboard_study_result` against the reopened
physical assembly and request. Full identities, request hashes and actual
checks are in each generated `worker-verification.json`.

| Example | PI load power | SI check | Steady thermal temperatures |
| --- | --- | --- | --- |
| UNO R4 + 4 Relays Shield | 0.998401918 W at 5 V, 25 ohm load | Full complex differential response agrees with the independent signal/return divider at all 17 frequencies | UNO 33.507778 C; shield 39.362806 C |
| CM4 IO + Sailor Hat | 1.992342062 W at 5 V, 12.5 ohm load | Maximum complex differential divider error 4.45e-16 V across 17 frequencies | Carrier 41.920106 C; HAT 49.351231 C |

Both thermal cases use 25 C ambient. Steady energy balance residual magnitudes
are 8.10e-14 W and 1.22e-11 W respectively. These check internal conservation;
they do not establish measured hardware accuracy.

## Native observations and fixes

Installed SPIKE v0.3.7 opened the Arduino package and displayed both boards in
the dedicated assembly viewport. Its Coupled studies panel loaded the retained
completed PI result and SI setup/result. The native PI Run command completed.
The full native walkthrough exposed two defects:

1. Automatic connector discovery collided with automatic assembly field-study
   reading, reporting `SPIKE-FE-APP-E-0001`. The development renderer now
   serializes these two automatic workloads. Generation/unmount guards discard
   stale responses. Explicit commands retain the existing busy guard. This
   queue does not coordinate other windows or already-active native work.
2. SI -> Thermal selection crashed with `Cannot read properties of undefined
   (reading 'map')`. The next domain rendered once with the previous domain's
   draft before an effect cleared it. The development editor now clears the
   previous draft/result and invalidates pending responses in the same update
   that changes domain. Dirty-discard transitions use the same path. Request
   validation and the numerical solver are unchanged.

Native screenshots are local under
`build/curated-multiboard-20261005/native`: `arduino-assembly-3d.jpg`,
`arduino-pi-reopened.jpg`, `arduino-si-setup.jpg`, and
`arduino-thermal-switch-error.jpg`. These show installed behavior, not a native
rerun of the development fixes. Native automation was interrupted by physical
Escape; a complete native Raspberry Pi workflow and native verification of the
new fixes remain unverified. No video recording of all six actions is claimed.

## Focused acceptance commands

### Saved-result discoverability follow-up

Both packages were reopened through `read_project_package` after a user reported
an empty PI Results panel. All three domains in each package still contain
completed results under `assembly_ir.extensions["spike.multiboard-studies"]`.
The single-board field panel reads a different result contract. An empty field
panel does not imply that the retained coupled study is missing.

The development Results panel now lists the studies embedded in the open
project. A **Show results** click validates and displays the selected numerical
result inline, without a file chooser or workspace navigation. A missing result
offers **Find result file**; a stale or invalid embedded result is withheld with
an actionable message. Async identity guards prevent a previous project's
result from appearing after an assembly or manifest change. The ordinary
**Load results** action opens this view when project results are available.
The exact viewer admission sequence was exercised against both generated
packages: `read_project_package`, `prepare_multiboard_study`, digest comparison,
and `validate_multiboard_study_result` using the prepared physical assembly.
All six retained PI/SI/Thermal results passed. This check does not rerun the
numerical solvers or establish native acceptance of the new UI.

The workspace also has a top **Studies & results** action targeting
the model editor. Reduced studies precede batch planning, and admitted result
tables precede their long setup forms. Circuit element tables show the worker's
returned signed DC currents/power or selected-frequency AC real/imaginary
currents and active/reactive power. No board-field samples are fabricated.
Regression checks cover the shortcut, table placement, local labels, sweep
selection, missing values and failed-result withholding. Installed-app access
continues to use **Workspace → Definition tools → Coupled studies** until the
updated renderer is packaged; native acceptance of these new shortcuts remains
unverified.

```powershell
.venv\Scripts\python.exe -m unittest `
  tests.python.test_arduino_shield_acceptance `
  tests.python.test_arduino_curated_multiboard `
  tests.python.test_rpi_hat_acceptance `
  tests.python.test_multiboard_study `
  tests.python.test_assembly_linked_nets -q
cd app
npm.cmd run test:assembly-structure-studies
npm.cmd run test:assembly-field-study
npm.cmd run test:button-standard
npm.cmd run build
```

The domain-switch regression exercises effect timing as well as rendering an
admitted retained thermal setup with board elements, links, contact models and
top-level radiation surfaces. The automatic queue regression checks concurrent
dispatch, stale queued requests and rejection recovery.

## Limits

The supplied circuit/contact/thermal parameters are assumptions recorded in
the walkthroughs. PCB artwork does not derive those values. No full-wave field,
distributed SI, eye-diagram, airflow or spatial temperature qualification is
claimed. The Arduino shield has no source component model assignments; its
native view reports placeholders. Import and stackup warnings remain visible.
Third-party CAD and generated packages remain local; provenance records retain
their licensing boundaries. No release or local installer update was performed
for these changes.
