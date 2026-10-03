# SPDX-License-Identifier: Apache-2.0
"""Convert admitted engine output without inventing unsolved port columns."""
import math
import re

from extension_sdk.python.spike_extension_sdk import analysis_envelope, analysis_result
from python.spike_core.extension_analysis_results import design_binding


def bound_provenance(request, raw):
    binding = design_binding(request["context"]["design"])
    if request["context"].get("design_binding") != binding:
        raise ValueError("OpenEMS result requires the current host design binding.")
    provenance = raw.get("provenance", {})
    if not isinstance(provenance, dict) or any(not re.fullmatch(r"[a-f0-9]{64}", str(provenance.get(k, ""))) for k in ("case_sha256", "generated_script_sha256")):
        raise ValueError("OpenEMS result requires authenticated case and actual execution-script digests.")
    return {**provenance, "design_id": binding["design_id"], "design_digest_sha256": binding["digest_sha256"]}


def grid_lines(raw):
    lines = raw.get("mesh", {}).get("lines_mm")
    if not isinstance(lines, dict) or set(lines) != {"x", "y", "z"}:
        raise ValueError("OpenEMS returned no complete actual CSXCAD grid.")
    for values in lines.values():
        if not isinstance(values, list) or not 2 <= len(values) <= 100000 or any(type(v) not in (int, float) or not math.isfinite(v) for v in values) or any(b <= a for a, b in zip(values, values[1:])):
            raise ValueError("Actual OpenEMS grid lines must be finite, bounded and strictly increasing.")
    metrics = raw.get("mesh", {}).get("actual_grid", {})
    if metrics.get("axis_cell_counts") != {axis: len(values)-1 for axis, values in lines.items()}:
        raise ValueError("Actual grid lines do not match admitted cell counts.")
    for axis, values in lines.items():
        spacings = [b-a for a,b in zip(values,values[1:])]
        for key, actual in (("minimum_spacing_mm",min(spacings)),("maximum_spacing_mm",max(spacings))):
            if key in metrics and not math.isclose(metrics[key][axis],actual,rel_tol=1e-10,abs_tol=1e-12):
                raise ValueError("Actual grid spacings do not match admitted metrics.")
    return lines


def mesh_envelope(request, raw):
    if raw.get("status") != "setup_completed":
        raise ValueError("Only actual completed OpenEMS setup can export a mesh.")
    mesh = {"contract": "spike/openems-grid/v1", "status": "completed", "model_status": "unvalidated",
        "solved": False, "units": "mm", "coordinate_frame": "design_top_copper",
        "lines_mm": grid_lines(raw), "actual_grid": raw["mesh"]["actual_grid"],
        "provenance": {**bound_provenance(request, raw), "operation": "setup_only",
            "reuse_scope": "OpenEMS authenticated case only; no cross-engine reuse or field validity"}}
    return {"contract": "spike/extension-result/v1", "status": "completed", "title": "Actual OpenEMS Cartesian grid (not solved)", "data": {"mesh_result": mesh}}


def network_columns(raw, ports, reference_impedance):
    frequencies, columns = raw.get("frequency_hz"), raw.get("s_parameters")
    if not isinstance(frequencies, list) or not 2 <= len(frequencies) <= 10001 or any(type(f) not in (int,float) or not math.isfinite(f) or f <= 0 for f in frequencies) or any(b <= a for a,b in zip(frequencies, frequencies[1:])):
        raise ValueError("OpenEMS port frequencies must be finite and increasing.")
    n = len(ports)
    if not 1 <= n <= 64 or n*n*len(frequencies) > 250000 or not isinstance(columns, dict) or not columns:
        raise ValueError("OpenEMS requires actual port columns.")
    if type(reference_impedance) not in (int,float) or not math.isfinite(reference_impedance) or reference_impedance <= 0:
        raise ValueError("OpenEMS reference impedance must be positive.")
    values = [[[None for _ in range(n)] for _ in range(n)] for _ in frequencies]
    valid = [[[False for _ in range(n)] for _ in range(n)] for _ in frequencies]
    present = set()
    for name, column in columns.items():
        matches = [(receive, excited) for receive in range(n) for excited in range(n) if name == f"s{receive+1}{excited+1}"]
        if len(matches) != 1 or not isinstance(column, dict):
            raise ValueError("OpenEMS port column name is invalid or ambiguous.")
        receive, excited = matches[0]
        real, imaginary = column.get("real"), column.get("imag")
        if any(not isinstance(a,list) or len(a) != len(frequencies) or any(type(v) not in (int,float) or not math.isfinite(v) for v in a) for a in (real, imaginary)):
            raise ValueError("OpenEMS port column samples do not match the frequency sweep.")
        present.add(excited)
        for i, pair in enumerate(zip(real, imaginary)):
            values[i][receive][excited] = list(pair)
            valid[i][receive][excited] = True
    excited = [i for i, port in enumerate(ports) if port.get("excite") is True]
    if len(excited) != 1 or present != set(excited) or len(columns) != n:
        raise ValueError("OpenEMS returned columns that do not match its single authenticated excitation.")
    return {"frequencies_hz": frequencies, "ports": [f"P{i+1}" for i in range(n)],
        "reference_impedance_ohm": reference_impedance, "values": values, "valid_mask": valid,
        "missing_columns": [f"P{i+1}" for i in range(n) if i not in present],
        "column_scope": "single actual excited port; other columns are null and invalid"}


def solve_envelope(request, raw, spec, options):
    if raw.get("status") != "completed":
        raise ValueError("OpenEMS did not return a completed field solve.")
    provenance = bound_provenance(request, raw)
    network = network_columns(raw, spec.options.get("ports", []), options.get("reference_impedance_ohm",50))
    if len(network["frequencies_hz"]) != spec.frequency_points or not math.isclose(network["frequencies_hz"][0], spec.frequency_start_hz, rel_tol=1e-9) or not math.isclose(network["frequencies_hz"][-1], spec.frequency_stop_hz, rel_tol=1e-9):
        raise ValueError("OpenEMS sweep does not match the prepared analysis.")
    fields = {"openems_grid": {"lines_mm": grid_lines(raw), "units": "mm"}}
    if raw.get("far_field") is not None:
        fields["openems_far_field"] = raw["far_field"]
    result = analysis_result(request, analysis_id="openems-"+str(request.get("request_id","run")), mode=spec.mode,
        model_status="unvalidated", solver="openEMS/"+str(provenance.get("engine_version") or "unknown"),
        networks={"s_parameters": network}, fields=fields,
        summary={"engine": "OpenEMS", "modeled_nets": spec.net_names, "port_mapping": spec.options.get("ports", []),
            "mesh": raw["mesh"]["actual_grid"], "analysis_scope": "full-wave AC port sweep; no DC PI solve",
            "far_field_view": "raw admitted NF2FF arrays; no EMerge spherical phase contract asserted"},
        provenance=provenance, issues=[{"code":"OPENEMS_CASE_UNVALIDATED", "severity":"warning",
            "message":"Case-specific geometry, ports, mesh convergence and physical correlation remain unvalidated. Missing excitation columns remain null; raw NF2FF is not an EMI compliance prediction."}])
    return analysis_envelope(result, title="OpenEMS full-wave "+spec.mode.upper())
