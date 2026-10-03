# OpenEMS Suite extension

This bundled SPIKE extension provides two optional full-wave workflows:
high-frequency PI port sweeps and SI interconnect port sweeps. The engine,
CSXCAD adapter, case integrity checks, validation, benchmark fixture, and
reference evidence live in this package. SPIKE's former `python/spike_core`
module names remain import bridges for existing CLI and desktop requests.

Open **Extension manager** and select **OpenEMS Suite**. Enter JSON options for
one of the contributions, for example:

```json
{
  "operation": "preflight",
  "analysis": {
    "net_names": ["SIGNAL", "GND"],
    "frequency_start_hz": 1000000,
    "frequency_stop_hz": 1000000000,
    "frequency_points": 101,
    "options": {"ports": []}
  },
  "engine_options": {"mesh_resolution_mm": 0.5}
}
```

`preflight` reports geometry, material, resource, and port readiness. `prepare`
creates an authenticated private case for inspection. `run` prepares a new case
and executes the installed OpenEMS/CSXCAD Python runtime if all gates pass.
Full execution needs explicit lumped ports with exactly one excited port. A
prepared case and result retain the adapter's artifact and version provenance.
The existing `spike openems-run` CLI command can run a previously prepared
case. Optional runtime installation is separate; the extension does not
download or bundle OpenEMS.

Undrilled rectangular, circular, oval, and rounded rectangular surface pads
are translated; curved contours are faceted and identified as approximate.
Drilled pads, via padstacks, zones without verified filled copper, and copper
cutouts block a field solve until their topology can be preserved. Imported
boards also need a physical stackup and reviewed signal/return port locations.

The PI contribution is for high-frequency PDN behavior, not DC voltage drop.
SI results are single-excitation S-parameters; a full matrix requires one run
per excited port. Arbitrary PCB results are unvalidated until independent
convergence and correlation evidence is supplied. OpenEMS has no thermal solver
in this suite. Its electromagnetic results are not converted into heat sources.

The host renders this package's menu and title bar. Both can be toggled from
the Extension manager and the preference persists locally.

## Workspace mesh and solved results

The legacy `openems-pi` and `openems-si` setup operations remain available;
`openems-em` adds the same preflight/prepare/run workflow in EM mode.
`openems-preview` prepares an authenticated case and shows the trusted adapter
body. Its `adapter_source_sha256` hashes that body only. Execution additionally
binds the case and a fresh run context; `generated_script_sha256` records the
complete bytes actually passed to the isolated interpreter. A preview body
digest does not claim to hash this later execution snapshot.

`openems-mesh` runs actual CSXCAD setup with `setup_only=True` and returns
`spike/openems-grid/v1`: complete sorted `lines_mm.x/y/z`, final-grid resource
metrics and exact board/case/execution-script provenance. Axes are capped at
100,000 lines each; they use board XY and top-copper Z=0 in millimetres. No
FDTD field sweep runs in this route. Missing runtime, blocked geometry, failed
setup or missing actual grid data never produce a mesh. The runtime uses
`SPIKE_STATE_HOME/jobs/openems` when that state override is configured.

`openems-pi-solve`, `openems-si-solve` and `openems-em-solve` publish host-bound
`spike/v1` AnalysisResults only after completed, admitted numerical execution.
PI is full-wave AC behavior. The network preserves the actual single excited
port column in `networks.s_parameters.values`; all other columns remain null
with a matching false `valid_mask` and their names in `missing_columns`.
No symmetry, reciprocity or missing samples are invented. A partial matrix
must not be exported as a complete Touchstone network. Ambiguous legacy
multi-digit S-parameter names fail closed, and the matrix exchange is capped
at 250,000 entries. The raw admitted NF2FF result is retained under
`fields.openems_far_field`, with actual grid lines under `fields.openems_grid`;
an EMerge far-field phase or calibrated power convention is not asserted.

A bounded original coplanar fixture completed the new mesh route with installed
OpenEMS 0.0.36: 51 X, 33 Y and 36 Z lines, or 56,000 cells. Host admission
confirmed the design binding and complete unsolved grid. A 30-second full-wave
trial on that fixture timed out while residual energy decayed slowly; its
failed result was rejected. These are execution and failure-gate observations,
not convergence or physics validation. Meshes and PCB results remain
unvalidated; cross-engine grid reuse and EMI compliance are not established.
