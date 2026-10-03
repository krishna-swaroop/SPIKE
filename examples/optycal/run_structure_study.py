# SPDX-License-Identifier: Apache-2.0
"""Reproduce an actual EMerge-driven Optycal PEC structure execution.

Uses SPIKE-owned patch PCB results and a SPIKE-owned STEP reflector. Explicit
source phase acknowledgement is required. This is not antenna qualification.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from extensions.optycal_suite.extension import execute
from extensions.optycal_suite.source import PHASE_ASSUMPTION
from python.spike_core.extension_analysis_results import admit_analysis_result


def save(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def render(result, directory):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    comparison = result["fields"]["comparison"]
    theta, phi = np.array(comparison["theta_deg"]), np.array(comparison["phi_deg"])
    shape = len(theta), len(phi)
    bare = np.array(comparison["bare_relative_db"]).reshape(shape)
    total = np.array(comparison["structure_relative_db"]).reshape(shape)
    cross = np.array(comparison["interference_cross_term"]).reshape(shape)
    delta = np.array(comparison["delta_db"]).reshape(shape)
    figure, axes = plt.subplots(1, 3, figsize=(14, 4), constrained_layout=True)
    axes[0].plot(theta, bare[:, 0], "o-", label="Bare antenna")
    axes[0].plot(theta, total[:, 0], "o-", label="Antenna + PEC structure")
    axes[0].set(xlabel="Theta (degrees), phi=0", ylabel="Amplitude (dB, common bare peak)", ylim=(max(-100, float(np.min([bare, total]))-5), float(np.max([bare, total]))+5), title="Coherent radiation cut")
    axes[0].legend()
    axes[0].grid(True)
    for axis, values, title, units in ((axes[1], delta, "Pattern change", "dB; deep nulls floored at -300"),
                                      (axes[2], cross, "Direct/scattered interference", "Cross term / bare peak |E| squared")):
        image = axis.pcolormesh(phi, theta, values, shading="nearest", cmap="RdBu_r")
        axis.set(xlabel="Phi (degrees)", ylabel="Theta (degrees)", title=title)
        figure.colorbar(image, ax=axis, label=units)
    figure.savefig(directory/"comparison_interference.png", dpi=140)
    plt.close(figure)
    ts, ps = np.meshgrid(np.radians(theta), np.radians(phi), indexing="ij")
    figure = plt.figure(figsize=(12, 5), constrained_layout=True)
    for index, (values, label) in enumerate(((bare, "Bare antenna"), (total, "Antenna + PEC structure")), 1):
        radius = 10**(values/20)
        axis = figure.add_subplot(1, 2, index, projection="3d")
        axis.plot_surface(radius*np.sin(ts)*np.cos(ps), radius*np.sin(ts)*np.sin(ps), radius*np.cos(ts),
                          facecolors=plt.cm.viridis(np.clip((values+40)/40, 0, 1)))
        axis.set(xlabel="X", ylabel="Y", zlabel="Z", title=label+"\nCommon bare amplitude reference")
        axis.set_box_aspect((1, 1, 1))
    figure.savefig(directory/"structure_patterns.png", dpi=140)
    plt.close(figure)
    index = int(np.argmax(total))
    ti, pi = divmod(index, len(phi))
    probe = {"sample_kind": "actual_solver_observation", "theta_deg": float(theta[ti]), "phi_deg": float(phi[pi]),
             "frequency_hz": comparison["frequency_hz"], **{key: comparison[key][index] for key in ("bare_relative_db", "structure_relative_db", "delta_db", "interference_cross_term", "direct_e_xyz", "scattered_e_xyz", "total_e_xyz")}}
    save(directory/"probe.json", probe)
    # The desktop and reproducible example use the same evidence-only renderer.
    subprocess.run(["node", "scripts/render-optycal-example.mjs", str(directory/"admitted_result.json"), str(directory/"report.html")], cwd=ROOT/"app", check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--acknowledge-phase-assumption", action="store_true")
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--mesh-size-mm", type=float, default=25.)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    directory = args.output.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if args.render_only:
        render(json.loads((directory/"admitted_result.json").read_text()), directory)
        return
    if not args.acknowledge_phase_assumption:
        parser.error("Explicit --acknowledge-phase-assumption is required; this is an assumed far-zone source model.")
    source = json.loads((ROOT/"examples/emerge/gui_workflow/patch_fields_admitted_result.json").read_text())
    binding = {"design_id": source["provenance"]["design_id"], "digest_sha256": source["provenance"]["design_digest_sha256"]}
    parameters = {"emerge_analysis_result": source, "frequency_hz": source["fields"]["radiation"]["frequencies_hz"][0], "step_path": str(ROOT/"examples/optycal/reflector.step"),
                  "structure_material": "PEC", "structure_translation_mm": [0, 0, 1000], "structure_rotation_deg": [0, 0, 0],
                  "antenna_translation_mm": [0, 0, 0], "antenna_rotation_deg": [0, 0, 0], "antenna_aperture_mm": 100,
                  "source_phase_assumption": PHASE_ASSUMPTION, "mesh_size_mm": args.mesh_size_mm,
                  "observation_radius_m": 100, "theta_step_deg": 15, "phi_step_deg": 30,
                  "python_executable": str(ROOT/".venv-emerge3/Scripts/python.exe")}
    request = {"contract": "spike/extension/v1", "request_id": "original-patch-reflector", "contribution_id": "optycal-preview",
               "context": {"parameters": parameters, "design_binding": binding}}
    preview = execute(request)["data"]
    (directory/"study.py").write_bytes(preview["script"].encode("utf-8"))
    save(directory/"preview.json", {k: v for k, v in preview.items() if k != "script"})
    parameters.update({"expected_generated_script_sha256": preview["script_sha256"], "expected_structure_source_sha256": preview["structure_source_sha256"]})
    request["contribution_id"] = "optycal-radiation"
    started = datetime.now(timezone.utc).isoformat()
    envelope = execute(request)
    completed = datetime.now(timezone.utc).isoformat()
    result = admit_analysis_result(envelope["data"]["analysis_result"], binding, extension_id="spike.optycal-suite")
    saved_hash = hashlib.sha256((directory/"study.py").read_bytes()).hexdigest()
    if result["provenance"]["generated_script_sha256"] != saved_hash:
        raise ValueError("Executed source does not match the displayed script.")
    save(directory/"admitted_result.json", result)
    save(directory/"execution_manifest.json", {"started_utc": started, "completed_utc": completed, "solver": result["provenance"]["solver"],
         "model_status": result["model_status"], "host_admission": "passed", "preview_matches_executed_source": True,
         "generated_script_sha256": saved_hash, "source_result_sha256": result["provenance"]["source_result_sha256"], "structure_source_sha256": result["provenance"]["structure_source_sha256"]})
    render(result, directory)
    print(json.dumps({"status": result["status"], "model_status": result["model_status"], "triangles": result["summary"]["setup"]["structure_triangle_count"], "angular_samples": result["summary"]["setup"]["angular_sample_count"], "report": str(directory/"report.html")}))


if __name__ == "__main__":
    main()
