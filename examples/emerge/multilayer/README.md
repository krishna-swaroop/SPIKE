# Original four-layer EMerge regression fixture

This SPIKE-authored DesignIR fixture has four copper layers, unequal
0.2/0.5/0.3 mm dielectric spacings and relative permittivities 3.2/4.1/3.8.
Selected RF copper is on F.Cu; selected ground is on In1.Cu. Two explicit
vertical ports connect these adjacent layers. In2.Cu and B.Cu contain no
selected-net copper. This is a small adapter exercise, not a real-board
correlation dataset.

On September 30, 2026, EMerge 3.0.0a19 and EMCAD 0.1.0 completed the
1/2 GHz two-port sweep at 0.7 mm requested copper mesh size (8,693 tetrahedra).
EMCAD reduced six input polygons to two same-net, same-layer unions.
`design.json`, `setup.json`, `case.json` and `result.json` retain the original
input, admitted geometry and solver-returned samples. They establish execution
compatibility only; the results remain **unvalidated**. Surface PEC,
rectangular bounds, omitted dielectric loss and finite absorbing boundaries
need refinement and independent physical correlation. No speed comparison
was performed.

To reproduce, install EMerge 3.0.0a19 and EMCAD 0.1.0 separately in an approved
Python environment, then run from the repository root:

```python
import json
from pathlib import Path
from extensions.emerge_suite.board_adapter import compile_board
from extensions.emerge_suite.extension import run_engine

root = Path("examples/emerge/multilayer")
design = json.loads((root / "design.json").read_text())
setup = json.loads((root / "setup.json").read_text())
case = compile_board(design, setup)
result = run_engine(case, radiation_requested=False,
                    python_executable=r".venv-emerge3/Scripts/python.exe")
Path("build/multilayer-result.json").write_text(json.dumps(result, allow_nan=False))
```

The interpreter path must refer to your installed environment. EMCAD is
optional: select `geometry_backend: "emerge"` to use the original geometry
path. Absence of EMCAD when explicitly selected is an error, with no fallback.
