# Arduino UNO R4 Minima and 4 Relays Shield

This curated example uses the real Arduino UNO R4 Minima (ABX00080) and
Arduino 4 Relays Shield (A000110) CAD archives. The repository records source
URLs and SHA-256 digests but does not redistribute their CAD. The generated
package is an experimental engineering precheck, not a production-qualified
electrical or thermal model.

## Reproduce the package and solver runs

Use Python 3.11 or newer, KiCad 10 or newer, and the repository virtual
environment. If the pinned archives already exist in the earlier acceptance
build, this command performs no network access:

```powershell
.venv\Scripts\python.exe scripts\build_arduino_shield_acceptance.py `
  --offline `
  --source-cache build\arduino-shield-acceptance-20261002\sources `
  --output-dir build\curated-multiboard-20261005\arduino
```

The command verifies both archive digests, imports the Altium and Eagle boards
with `kicad-cli`, checks object counts, aligns the physical header pins, runs
PI, SI, and steady thermal studies, and saves all three setups and results into
`arduino-r4-relay-shield.spike`. It reopens and validates the saved state before
returning success. Standalone request/result JSON files remain beside the
package for audit and numerical comparison.

## Open and inspect in the desktop app

1. Start SPIKE and choose **Open project**.
2. Select
   `build/curated-multiboard-20261005/arduino/arduino-r4-relay-shield.spike`.
3. Open **Multi-board workspace** from the Design tools.
4. Open **Coupled studies**. In the **Study** selector choose **Power integrity
   (PI)**. Its saved setup and completed result load from the package's verified
   state artifact. Use **Run coupled PI** to execute the displayed values again.
   When it completes, choose **Save study with results**; wait for the saved PI
   status before changing domains. **Save study setup** intentionally retains
   inputs without the just-run output.
5. In PI, inspect UNO `JANALOG:5` (5 V source), `JANALOG:6` (ground), shield
   `POWER0:5` (load positive), and `POWER0:6` (load return). The explicit
   25 ohm relay-bank surrogate draws 0.1998401279 A through 0.02 ohm total
   connector resistance. Returned load power is 0.998401918 W and the two load
   terminals are 4.998001599 V and 0.001998401 V.
6. In the **Study** selector choose **Signal integrity (SI)**. If a dirty-study
   warning appears, save the current study or explicitly choose **Discard
   changes and switch**. Inspect UNO `JDIGITAL:6` to shield `JLOW0:6`. A 1 V AC ideal source
   drives a 10 kohm load through an explicit 0.02 ohm, 5 nH signal connection;
   the return connection adds 0.01 ohm and 2 nH. The 17-point logarithmic sweep
   spans 1 kHz to 10 MHz. Returned load magnitude is 0.9999980000 V at 1 kHz
   and 0.9999979991 V at 10 MHz, with -0.001799993 degrees phase at 10 MHz.
   Choose **Run coupled SI**, then **Save study with results** after completion.
7. Choose **Thermal** in the **Study** selector, resolving any dirty-study
   warning as above. Inspect the steady board temperatures: 33.50777841 C for the
   UNO and 39.36280563 C for the shield at 25 C ambient. Inputs are 0.35 W UNO
   dissipation, the PI-derived 0.998401918 W shield dissipation, 18 and
   22 C/W ambient resistances, 0.025 W/K header contact conductance, emissivity
   0.85, and explicit reciprocal view factors. The returned total input and
   ambient heat flow are 1.3484019179580362 W and 1.3484019179581173 W. Choose
   **Run coupled THERMAL**, then **Save study with results**. Close and reopen
   the `.spike` project and revisit all three selector entries to confirm each
   completed result remains available.

All three runs were produced and reopened through project services. Installed
v0.3.7 also opened the assembly, displayed retained PI/SI studies and completed
a native PI run. Switching SI to Thermal exposed an interface crash, fixed in
the development editor and covered by a transition regression. The installed
app has not received that fix. See the
[native observation record](../../../docs/validation/CURATED_MULTIBOARD_STUDIES_20261005.md).

## Independent checks and limits

For PI, Ohm's law gives `5 V / (25 + 0.02) ohm = 0.1998401279 A`; multiplying
the squared current by 25 ohm gives 0.998401918 W. For SI, the complex
differential load voltage is checked at all 17 frequencies against the complete
explicit signal and return network, including the parallel 2 Mohm bias path
formed by the two 1 Mohm power-bias elements. Thermal conservation is checked by comparing
total supplied power with returned ambient heat flow and by bounding both the
network and radiosity closure residuals.

These are supplied reduced models. PCB geometry is retained for review but does
not generate the RLC values, loss, view factors, airflow, spatial temperatures,
eye diagrams, nonlinear drivers, or full-wave fields. The imported boards have
no usable stackup rows, and both imports complete with warnings. The evidence
in [acceptance-results.json](acceptance-results.json) records the exact values
and package identity from the fresh 2026-10-05 run.
