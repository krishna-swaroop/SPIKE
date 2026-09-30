# SPDX-License-Identifier: Apache-2.0
"""Study preparation, finite-domain guards and readable owned Python source."""
from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import pprint
import subprocess
import tempfile

from extensions.optycal_suite.source import prepare_source, number, vector


def prepare_case(parameters, binding, *, mesher=None):
    case = prepare_source(parameters, binding)
    if parameters.get("structure_material", "PEC") != "PEC":
        raise ValueError("The initial Optycal adapter supports explicit PEC structures only.")
    if mesher is None:
        mesher = lambda path, **kwargs: mesh_in_runtime(path, python_executable=parameters.get("python_executable"), **kwargs)
    path = parameters.get("step_path")
    if not isinstance(path, str) or not path:
        raise ValueError("Select a STEP structure path.")
    case["structure_mesh"] = mesher(path,
        mesh_size_mm=number(parameters.get("mesh_size_mm", 20), "mesh_size_mm", 0.01, 1000),
        translation_mm=vector(parameters.get("structure_translation_mm", [0, 0, 0]), "structure translation", 1e6),
        rotation_deg=vector(parameters.get("structure_rotation_deg", [0, 0, 0]), "structure rotation", 360),
        expected_sha256=parameters.get("expected_structure_source_sha256"))
    validate_geometry(case)
    return case


def mesh_in_runtime(path, *, python_executable=None, **settings):
    """Keep optional Gmsh/OCC loading in the selected solver environment."""
    project = Path(__file__).resolve().parents[2]
    executable = Path(python_executable).expanduser().resolve() if python_executable else project/".venv-emerge3/Scripts/python.exe"
    if not executable.is_file():
        raise ValueError("Selected solver Python executable is missing.")
    script = Path(__file__).with_name("step_geometry.py")
    with tempfile.TemporaryDirectory(prefix="spike-optycal-step-") as directory:
        root = Path(directory)
        settings_path, output_path, log_path = root/"settings.json", root/"mesh.json", root/"mesh.log"
        settings_path.write_text(json.dumps({"path": path, **settings}, allow_nan=False), encoding="utf-8")
        code = ("import runpy,json,pathlib,sys; module=runpy.run_path(sys.argv[1]); "
                "settings=json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8')); "
                "mesh=module['mesh_step'](**settings); pathlib.Path(sys.argv[3]).write_text(json.dumps(mesh,allow_nan=False),encoding='utf-8')")
        try:
            with log_path.open("wb") as log:
                process = subprocess.run([str(executable), "-I", "-X", "utf8", "-c", code, str(script), str(settings_path), str(output_path)],
                    cwd=root, stdout=log, stderr=subprocess.STDOUT, timeout=180,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except subprocess.TimeoutExpired as error:
            raise ValueError("STEP numerical meshing exceeded 180 seconds.") from error
        if process.returncode:
            with log_path.open("rb") as log:
                size = log.seek(0, 2)
                log.seek(max(0, size-4000))
                diagnostic = log.read().decode("utf-8", errors="replace")
            raise ValueError("STEP meshing failed in the selected solver runtime: "+diagnostic)
        if not output_path.is_file() or output_path.stat().st_size > 8*1024*1024:
            raise ValueError("STEP meshing returned no bounded numerical mesh.")
        return json.loads(output_path.read_text(encoding="utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def validate_geometry(case):
    """Conservative separation guards for the assumed outgoing far-zone source."""
    import numpy as np
    mesh = case["structure_mesh"]
    if mesh.get("contract") != "spike/optycal-structure-mesh/v1":
        raise ValueError("A bounded numerical structure mesh is required.")
    vertices = np.asarray(mesh.get("vertices_mm"), dtype=float)*.001
    triangles = np.asarray(mesh.get("triangles"))
    if (vertices.ndim != 2 or vertices.shape[1] != 3 or not 4 <= len(vertices) <= 120000 or
            not np.all(np.isfinite(vertices)) or triangles.ndim != 2 or triangles.shape[1] != 3 or
            not 4 <= len(triangles) <= 40000 or not np.issubdtype(triangles.dtype, np.integer) or
            np.min(triangles) < 0 or np.max(triangles) >= len(vertices)):
        raise ValueError("Structure mesh needs finite vertices and bounded triangle topology.")
    # A triangle lies inside its centroid bounding ball, so d(center)-radius is
    # a conservative lower distance bound, including the triangle interior.
    tv = vertices[triangles]
    centers = np.mean(tv, axis=1)
    triangle_radius = np.max(np.linalg.norm(tv-centers[:, None, :], axis=2), axis=1)
    source = np.asarray(case["antenna_translation_mm"])*.001
    minimum_separation = float(np.min(np.linalg.norm(centers-source, axis=1)-triangle_radius))
    wavelength = 299792458/case["frequency_hz"]
    aperture = case["antenna_aperture_mm"]*.001
    required_separation = max(2*aperture**2/wavelength, 5*wavelength)
    if minimum_separation < required_separation:
        raise ValueError(f"Structure is too close for far-zone source illumination: conservative separation {minimum_separation:.4g} m; required {required_separation:.4g} m. Use a full-wave EMerge assembly model for nearby structures.")
    diameter = float(np.linalg.norm(np.ptp(vertices, axis=0)))
    assembly_radius = max(float(np.max(np.linalg.norm(vertices, axis=1))), float(np.linalg.norm(source))+aperture)
    required_observation = max(2*(diameter+aperture)**2/wavelength, 10*assembly_radius, 5*wavelength)
    if case["observation_radius_m"] < required_observation:
        raise ValueError(f"Observation radius must be at least {required_observation:.4g} m for the admitted assembly far zone.")
    samples = (180//case["theta_step_deg"]+1)*(360//case["phi_step_deg"]+1)
    if len(triangles)*samples > 80_000_000:
        raise ValueError("Triangle-by-observation budget exceeds 80 million; coarsen the mesh or angular grid.")
    case.update({"structure_material": "PEC", "minimum_separation_bound_m": minimum_separation,
                 "required_separation_m": required_separation, "required_observation_radius_m": required_observation,
                 "angular_sample_count": samples, "structure_triangle_count": len(triangles)})


def generate_script(case):
    """Embed SPIKE-owned adapter functions and the exact bounded numeric case."""
    source = Path(__file__).with_name("runner.py").read_text(encoding="utf-8")
    parsed = ast.parse(source)
    functions = [ast.get_source_segment(source, node) for node in parsed.body if isinstance(node, ast.FunctionDef)]
    script = ("# SPDX-License-Identifier: Apache-2.0\n"
              "# Generated SPIKE Optycal one-way PEC physical-optics study.\n"
              "# Approximate and unvalidated; outgoing EMerge source convention is explicitly assumed.\n"
              "from __future__ import annotations\nimport math\nimport argparse\nimport json\n"
              "from pathlib import Path\n\n" + "\n\n".join(functions) + "\n\nCASE = " +
              pprint.pformat(case, width=100, sort_dicts=True) +
              "\n\nif __name__ == '__main__':\n"
              "    parser = argparse.ArgumentParser()\n"
              "    parser.add_argument('--result', required=True)\n"
              "    args = parser.parse_args()\n"
              "    Path(args.result).write_text(json.dumps(run_case(CASE), allow_nan=False), encoding='utf-8')\n")
    if len(script.encode("utf-8")) > 4*1024*1024:
        raise ValueError("Readable generated study exceeds 4 MiB; reduce the structure mesh.")
    compile(script, "optycal_study.py", "exec")
    case_bytes = json.dumps(case, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return {"script": script, "script_sha256": hashlib.sha256(script.encode("utf-8")).hexdigest(),
            "case_sha256": hashlib.sha256(case_bytes).hexdigest()}
