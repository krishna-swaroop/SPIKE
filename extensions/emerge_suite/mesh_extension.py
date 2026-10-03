# SPDX-License-Identifier: Apache-2.0
"""Design-bound mesh-only applications, separate from AnalysisResult solves."""
from __future__ import annotations

import hashlib
import json
import types

from extensions.emerge_suite.mesh_capture import capture_mesh
from extensions.emerge_suite.script_builder import generate_script


def design_digest(design):
    """Match the host's finite canonical SpiDeR design binding."""
    if not isinstance(design, dict) or design.get("contract") != "spike/v1" or not isinstance(design.get("design_id"), str) or not design["design_id"].strip():
        raise ValueError("An admitted SpiDeR board is required for mesh binding.")
    canonical = json.dumps(design, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return {"design_id": design["design_id"], "digest_sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest()}


def normalize_mesh(raw):
    """Recheck the engine's complete topology at the optional-process boundary."""
    import numpy as np
    if (not isinstance(raw, dict) or raw.get("contract") != "spike/emerge-mesh/v1" or
            raw.get("status") != "completed" or raw.get("solved") is not False or
            raw.get("model_status") != "unvalidated" or raw.get("units") != "mm" or
            raw.get("coordinate_frame") != "design_top_copper"):
        raise ValueError("EMerge returned no supported, unsolved millimetre mesh.")
    def groups(name):
        entries = raw.get(name)
        if not isinstance(entries, list) or len(entries) > 8192 or any(not isinstance(v, dict) for v in entries):
            raise ValueError("EMerge mesh entity groups are malformed.")
        tags = [value.get("entity_tag") for value in entries]
        if any(isinstance(value, bool) or not isinstance(value, int) for value in tags) or len(set(tags)) != len(tags):
            raise ValueError("EMerge mesh entity tags must be distinct integers.")
        return {value["entity_tag"]: value.get("indices") for value in entries}
    try:
        nodes = np.asarray(raw.get("nodes_mm"))
        if not np.issubdtype(nodes.dtype, np.number) or np.issubdtype(nodes.dtype, np.bool_):
            raise ValueError("Mesh coordinates must be finite numeric values.")
        mesh = types.SimpleNamespace(nodes=nodes.T/1000., tets=np.asarray(raw.get("tetrahedra")).T,
            tris=np.asarray(raw.get("triangles")).T, vtag_to_tet=groups("volume_groups"), ftag_to_tri=groups("surface_groups"))
        normalized = capture_mesh(mesh)
    except (TypeError, OverflowError) as error:
        raise ValueError("EMerge mesh arrays must contain bounded numeric topology.") from error
    for name in ("node_count", "tetrahedron_count", "triangle_count"):
        if raw.get(name) != normalized[name]:
            raise ValueError("EMerge mesh cell counts do not match its complete connectivity.")
    if raw.get("bounds_mm") != normalized["bounds_mm"]:
        if not isinstance(raw.get("bounds_mm"), list) or not np.allclose(raw["bounds_mm"], normalized["bounds_mm"], rtol=1e-12, atol=1e-12):
            raise ValueError("EMerge mesh bounds do not match its node coordinates.")
    return normalized


def execute_mesh(request, case, *, backend):
    context = request["context"]
    parameters = context["parameters"]
    binding = design_digest(context["design"])
    supplied_binding = context.get("design_binding")
    if supplied_binding is not None and supplied_binding != binding:
        raise ValueError("EMerge mesh design binding does not match the current board.")
    generated = generate_script(case, radiation_requested=False, mesh_only=True)
    if request["contribution_id"] == "emerge-mesh-preview":
        return {"contract": "spike/extension-result/v1", "status": "completed", "title": "Prepared EMerge PCB mesh (not generated or solved)",
                "data": {**generated, "case": case, "design_binding": binding, "solved": False,
                         "mesh_generated": False, "model_status": "unvalidated", "operation": "mesh"}}
    expected = parameters.get("expected_generated_script_sha256")
    if expected != generated["script_sha256"]:
        raise ValueError("EMerge mesh inputs changed after script preview; prepare the current mesh again.")
    raw = backend(case, radiation_requested=False, mesh_only=True,
                  python_executable=parameters.get("python_executable"), expected_script_sha256=expected)
    if not isinstance(raw, dict) or not isinstance(raw.get("engine_version"), str) or not raw["engine_version"]:
        raise ValueError("EMerge returned no versioned mesh execution.")
    if raw.get("generated_script_sha256", expected) != expected:
        raise ValueError("EMerge mesh execution does not match the prepared script.")
    mesh = normalize_mesh(raw.get("mesh"))
    mesh["provenance"] = {"design_id": binding["design_id"], "design_digest_sha256": binding["digest_sha256"],
        "case_sha256": generated["case_sha256"], "generated_script_sha256": raw.get("generated_script_sha256", generated["script_sha256"]),
        "solver": "EMerge/"+raw["engine_version"], "extension_id": "spike.emerge-suite", "case_contract": case["contract"],
        "operation": "mesh_only", "geometry_status": case["geometry_status"], "geometry_backend": case["geometry_backend"],
        "geometry_backend_version": raw.get("geometry_backend_version"), "modeled_nets": case["modeled_nets"],
        "copper_layers": case["copper_layers"], "dielectric_layers": case["dielectric_layers"],
        "requested_mesh_resolution_mm": case["mesh_resolution_mm"], "air_margin_m": raw.get("air_margin_m"),
        "reuse_scope": "EMerge PCB case only; no arbitrary solver mesh compatibility or field-solve validity established",
        "qualification": "not independently validated"}
    mesh["issues"] = [{"code": "EMERGE_MESH_UNVALIDATED", "severity": "warning",
        "message": "Actual tetrahedral mesh of the selected-net approximate PCB and finite air region. No field solve, mesh convergence or unrelated-solver compatibility is established."}]
    envelope = {"contract": "spike/extension-result/v1", "status": "completed", "title": "EMerge PCB tetrahedral mesh (not solved)",
                "data": {"mesh_result": mesh, "input_design_sha256": binding["digest_sha256"], "solved": False}}
    if len(json.dumps(envelope, allow_nan=False).encode("utf-8")) > 8*1024*1024:
        raise ValueError("Complete EMerge mesh exceeds the 8 MiB exchange budget; use a coarser mesh. No truncated mesh was returned.")
    return envelope
