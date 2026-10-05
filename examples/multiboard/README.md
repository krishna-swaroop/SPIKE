# Curated multi-board studies

Two real retained-board assemblies have reproducible PI, SI and Thermal setups,
completed results, and project reopen checks:

| Assembly | Walkthrough | Generated project |
| --- | --- | --- |
| Arduino UNO R4 Minima + Arduino 4 Relays Shield | [Arduino steps and results](arduino/README.md) | `build/curated-multiboard-20261005/arduino/arduino-r4-relay-shield.spike` |
| Raspberry Pi CM4 IO Board + Sailor Hat | [Raspberry Pi steps and results](raspberry_pi/README.md) | `build/curated-multiboard-20261005/raspberry-pi/cm4io-sailor-hat.spike` |

The Raspberry Pi example models the IO carrier and HAT, not the Compute Module
or a Raspberry Pi SBC. Both examples use supplied reduced circuit and thermal
networks. Imported artwork does not automatically establish connector RLC,
distributed SI, spatial temperature, airflow or full-wave fields. Parameters
and their assumptions are recorded in each walkthrough.

## Repeat the actual desktop worker runs

After building both examples using their individual instructions:

```powershell
.venv\Scripts\python.exe scripts\verify_curated_multiboard_worker.py `
  build\curated-multiboard-20261005\arduino `
  build\curated-multiboard-20261005\raspberry-pi
```

This launches the JSON-line worker separately for each of the six studies,
requires completed status and exact equality with the generated result, and
writes `worker-verification.json` beside each package. It also reopens each
package through the worker, checks the hydrated result against its sidecar and
validates its assembly/setup binding. Startup and validation time are included
in the recorded elapsed time; it is not a solver benchmark.

To view saved results, open the `.spike` package and choose **Results**. The
**Saved assembly results** list shows the studies in that project. Click a
study's **Show results** button to display its values directly; no external file
selection or assembly setup navigation is needed. If the project has no result
for that study, **Find result file** offers external import. Assembly/setup
binding is validated before numerical values appear. Stale or invalid embedded
results show a repair message instead of a file chooser.

To edit models or rerun studies, open the dedicated **Multi-board workspace**. Choose
**Studies & results** in the top command bar, and select the PI, SI or Thermal
study. On installed builds without this shortcut, scroll below the assembly
viewport to **Definition tools** and choose **Coupled studies**. The normal single-board **Run DC**
button operates on a different setup; it does not run these coupled studies.
Choose **Run coupled ...**, then **Save study with results** before changing
domain or closing. Detailed terminal names, inputs and expected outputs are in
the individual walkthroughs.

Coupled results are retained in the assembly's study records, separately from
single-board field results. The PI field viewer can therefore show **No solver
result loaded** while this project has completed coupled studies. Use the
**Show results** buttons in the Results viewer to access them in updated builds.
Saved study statuses are inventory labels; binding is checked on opening. The
results table appears above model setup and includes returned element currents
and power for circuit studies, node voltages, and board temperatures for thermal
studies. AC quantities follow the selected result frequency. These reduced
results do not supply spatial board-field samples.

## Evidence and recovery

Generated CAD packages, full result files and native screenshots stay local in
`build/curated-multiboard-20261005`; they are not public release assets.
Third-party source attribution and licensing remain in the provenance records.
The checked-in Arduino numerical receipt and both independent oracle tests
document what was actually executed on 2026-10-05.
See [execution and native observations](../../docs/validation/CURATED_MULTIBOARD_STUDIES_20261005.md)
for the checks and the two UI defects discovered by the native walkthrough.

- If imported stackup rows are missing, review **Stackup**. Do not interpret
  the supplied AC divider as a geometry-extracted PCB channel.
- If native graphics are preparing, wait for the import/model operation to
  finish before reviewing the 3D view. A completed circuit solve does not imply
  that every component model resolved.
- If connector discovery reports `SPIKE-FE-APP-E-0001`, wait for the named
  operation to finish and choose **Refresh connectors**. This was observed in
  installed v0.3.7 when opening the Arduino workspace; it does not invalidate
  the saved numerical result. The development fix is separately verified.
- Changing physical placement or links invalidates the assembly identity of
  retained results. Save the structure, review the model and rerun the study.
