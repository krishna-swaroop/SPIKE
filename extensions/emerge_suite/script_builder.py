# SPDX-License-Identifier: Apache-2.0
"""Deterministic, readable standalone Python for the admitted GUI case.

Only SPIKE-owned adapter functions are emitted. The separately installed
solver's implementation is never read, embedded or redistributed.
"""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import pprint


MAX_SCRIPT_BYTES = 2 * 1024 * 1024


def _adapter_source(name: str) -> str:
    path = Path(__file__).with_name(name + ".py")
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    pieces = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(("__future__", "extensions.")):
                continue
            pieces.append(ast.get_source_segment(source, node))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.name != "main":
                pieces.append(ast.get_source_segment(source, node))
        elif isinstance(node, ast.Assign):
            # The runner's physical constants, not its sys.path bootstrap.
            pieces.append(ast.get_source_segment(source, node))
    return "\n\n".join(pieces)


def generate_script(case: dict, *, radiation_requested: bool) -> dict:
    """Return exactly the source executed by the contained solver process."""
    if not isinstance(case, dict) or case.get("contract") != "spike/emerge-board-case/v1":
        raise ValueError("Generated script requires an admitted EMerge board case.")
    case_json = json.dumps(case, sort_keys=True, separators=(",", ":"), allow_nan=False)
    # Pretty Python literals keep geometry readable. JSON admission above and
    # pprint's escaped string representation prevent source names becoming code.
    preamble = (
        "# SPDX-License-Identifier: Apache-2.0\n"
        '"""SPIKE GUI-generated EMerge model; results remain unvalidated.\n'
        "Run with the selected EMerge Python interpreter: simulation.py --result result.json\n"
        'Only declared GUI settings define the model. No network access is requested.\n"""\n'
        "from __future__ import annotations\n"
        "import json\n"
        "MAX_POLYGONS = 4096\nMAX_VERTICES = 200000\n"
        f"CASE = {pprint.pformat(case, sort_dicts=True, width=100)}\n"
        f"RADIATION_REQUESTED = {bool(radiation_requested)!r}\n"
    )
    modules = ["capture", "emcad_geometry", "runner"]
    sections = []
    for name in modules:
        section = _adapter_source(name)
        if name == "runner":
            # merge_copper is emitted above; imports inside the function must
            # not depend on a SPIKE checkout in the selected interpreter.
            section = section.replace("        from extensions.emerge_suite.emcad_geometry import merge_copper\n", "")
        sections.append(f"# SPIKE-owned {name} adapter\n{section}")
    driver = '''
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    import emerge as em
    result = run_case(CASE, em, radiation=RADIATION_REQUESTED)
    output = Path(args.result)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, output)

if __name__ == "__main__":
    main()
'''
    script = preamble + "\n\n".join(sections) + "\n" + driver
    if len(script.encode("utf-8")) > MAX_SCRIPT_BYTES:
        raise ValueError("Generated EMerge script exceeds the 2 MiB preview budget.")
    compile(script, "SPIKE_EMerge_simulation.py", "exec")
    return {"script": script,
            "script_sha256": hashlib.sha256(script.encode("utf-8")).hexdigest(),
            "case_sha256": hashlib.sha256(case_json.encode("utf-8")).hexdigest()}
