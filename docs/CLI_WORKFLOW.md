# SPIKE CLI Workflow

The CLI uses the same SpiDeR, AnalysisSpec, preflight, solver, and report
contracts as the desktop application. Commands run locally without a network
connection. Run them from the SPIKE repository root.

Choose a board that you are authorized to analyze. Replace the placeholders
below with reviewed net names, terminal locations, and operating conditions
from that board before running an analysis.

## Import and inspect

```powershell
python -m python.spike_core.cli --output design.json --quiet import "path/to/your-board.kicad_pcb"
python -m python.spike_core.cli inspect design.json
python -m python.spike_core.cli inspect design.json --section stackup
python -m python.spike_core.cli inspect design.json --section nets
python -m python.spike_core.cli validate design.json
```

## Prepare and run DCIR

`setup-dc` creates a request without running the solver. Coordinates are in
millimetres. Select mesh and resource limits suitable for the study.

```powershell
python -m python.spike_core.cli --output dc-request.json --quiet setup-dc design.json `
  --net "<net-name>" `
  --source "<x-mm>,<y-mm>,<layer>,<current-A>" `
  --load "<x-mm>,<y-mm>,<layer>,<current-A>" `
  --mesh-size-mm 0.5 `
  --zone-cell-mm 0.5 `
  --max-conductors 50000 `
  --via-model extracted

python -m python.spike_core.cli preflight dc-request.json
python -m python.spike_core.cli --output dc-mesh.json --quiet mesh-preview dc-request.json
python -m python.spike_core.cli --output dc-result.json --quiet run dc-request.json
python -m python.spike_core.cli report dc-result.json --report-format html --report-output dc-report.html
python -m python.spike_core.cli report dc-result.json --report-format csv --report-output dc-fields.csv
```

`--via-model extracted` uses imported via spans, drills, and available plating
data. Run only when preflight reports `can_solve: true`. Add `--include-cells`
only when full cell geometry is needed inline; otherwise use `mesh-preview`.
The result includes voltages, currents, copper loss, mesh data, warnings, and
run settings. A completed run alone does not establish convergence or accuracy.

## Prepare and run AC R/L extraction

The frequency range and mesh settings illustrate syntax; they are not a
validated range for an arbitrary board.

```powershell
python -m python.spike_core.cli --output ac-request.json --quiet setup-ac design.json `
  --net "<net-name>" `
  --source "<x-mm>,<y-mm>,<layer>,<label>" `
  --load "<x-mm>,<y-mm>,<layer>,<label>" `
  --start-hz 1000 `
  --stop-hz 30000000 `
  --points 9 `
  --mesh-size-mm 2 `
  --zone-cell-mm 2 `
  --memory-limit-gb 2 `
  --via-model extracted `
  --skin-effect

python -m python.spike_core.cli preflight ac-request.json
python -m python.spike_core.cli --output ac-result.json --quiet run ac-request.json
python -m python.spike_core.cli report ac-result.json --report-format html --report-output ac-report.html
```

The AC result reports series resistance, partial inductance,
single-reference approximate capacitance and dielectric conductance, complex
impedance versus frequency, warnings, and run details. It does not establish
validated multiport PDN impedance or arbitrary-geometry capacitance.

## Other commands

```powershell
python -m python.spike_core.cli solvers
python -m python.spike_core.cli benchmark
python -m python.spike_core.cli extract-net design.json --net "<net-name>"
python -m python.spike_core.cli compare baseline.json candidate.json --tolerance-percent 2
python -m python.spike_core.cli run batch-manifest.json --continue-on-error
```
