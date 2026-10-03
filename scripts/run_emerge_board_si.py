# SPDX-License-Identifier: Apache-2.0
"""Run disclosed, source-derived coupled route sections through EMerge SI.

The original boards remain inert local evaluation fixtures. This does not solve
their complete routing, devices, return-plane voids or differential interfaces.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from python.spike_core.extensions import ExtensionRegistry
from python.spike_core.extension_analysis_results import admit_analysis_result, design_binding


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def build_section(name: str, selection: dict) -> tuple[dict, dict, dict]:
    """Rotate two source-derived parallel, disjoint segments onto the Y axis."""
    source = ROOT / selection["source_path"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != selection["source_sha256"]:
        raise ValueError("Source fixture changed; inspect the route selection again.")
    tracks = selection["tracks"]
    if len(tracks) != 2 or tracks[0]["net_name"] == tracks[1]["net_name"]:
        raise ValueError("Choose two distinct signal routes.")
    endpoints = selection["overlap"]
    origin = np.array(endpoints[0][0], dtype=float)
    axis = np.array(endpoints[0][1], dtype=float) - origin
    length = np.linalg.norm(axis)
    if not 1 <= length <= 40:
        raise ValueError("Bounded SI section length must be 1..40 mm.")
    axis /= length
    normal = np.array([axis[1], -axis[0]])
    rotation = np.array([normal, axis])
    positions = [[(rotation @ (np.array(point) - origin)).tolist() for point in pair]
                 for pair in endpoints]
    widths = [float(track["width"]) for track in tracks]
    if any(width < .05 for width in widths):
        raise ValueError("Port width requires traces at least 0.05 mm wide.")
    for track, points, original in zip(tracks, positions, endpoints):
        a, b = np.array(track["start"]), np.array(track["end"])
        vector = b - a
        for point in original:
            delta = np.array(point) - a
            fraction = np.dot(delta, vector) / np.dot(vector, vector)
            distance = np.linalg.norm(delta - fraction * vector)
            if distance > 1e-6 or not -1e-8 <= fraction <= 1 + 1e-8:
                raise ValueError("Section endpoints must lie on the actual source segments.")
        if abs(points[1][0] - points[0][0]) > 1e-6:
            raise ValueError("Source segments must be parallel.")
    gap = abs(positions[1][0][0] - positions[0][0][0]) - sum(widths) / 2
    if gap <= 0:
        raise ValueError("Coupled conductors must have disjoint footprints.")
    points = np.array([point for pair in positions for point in pair])
    bounds = [float(points[:, 0].min() - 2), float(points[:, 1].min() - 1),
              float(points[:, 0].max() + 2), float(points[:, 1].max() + 1)]
    dielectric = selection["dielectric"]
    ground = "__idealized_reference__"
    pads, retained_tracks, pairs = [], [], []
    for index, (track, xy) in enumerate(zip(tracks, positions)):
        retained_tracks.append({"id": track["id"] + "-section", "net_name": track["net_name"],
                                "layer": "F.Cu", "start": xy[0], "end": xy[1], "width": widths[index]})
        for end, coordinate in enumerate(xy):
            signal_id, return_id = f"section-{index}-{end}", f"reference-{index}-{end}"
            for identity, net, layer in ((signal_id, track["net_name"], "F.Cu"),
                                          (return_id, ground, "B.Cu")):
                pads.append({"id": identity, "net_name": net, "layer": layer, "layers": [layer],
                             "shape": "rect", "at": coordinate, "size": [widths[index], .04], "rotation": 0})
            pairs.append({"signal_net": track["net_name"], "signal_pad_id": signal_id, "return_pad_id": return_id})
    xmin, ymin, xmax, ymax = bounds
    design = {"contract": "spike/v1", "units": "mm", "design_id": f"{name}-coupled-route-section",
              "name": f"{name} source-derived SI subsection", "tracks": retained_tracks, "pads": pads, "vias": [],
              "zones": [{"id": "idealized-reference-plane", "net_name": ground, "layer": "B.Cu",
                         "source_kind": "idealized_reference_plane", "attribution_reason":
                         "Explicit continuous local reference-plane assumption; source voids and return topology are omitted",
                         "points": [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]]}],
              "stackup": [{"name": "F.Cu", "type": "copper"},
                          {"name": "local dielectric", "type": "core", "thickness": dielectric["thickness_mm"],
                           "epsilon_r": dielectric["epsilon_r"], "loss_tangent": dielectric["loss_tangent"]},
                          {"name": "B.Cu", "type": "copper"}],
              "metadata": {"board_bounds_mm": bounds, "source_sha256": selection["source_sha256"], "subsection": True}}
    parameters = {"signal_net": tracks[0]["net_name"], "additional_signal_nets": [tracks[1]["net_name"]],
                  "return_net": ground, "port_pairs": pairs, "frequency_start_hz": 1e8,
                  "frequency_stop_hz": 6.4e9, "frequency_points": 64, "mesh_resolution_mm": .5,
                  "reference_impedance_ohm": 50, "include_dielectric_loss": True,
                  "air_margin_mm": 10, "sparse_solver": "auto", "geometry_backend": "emcad",
                  "nearfield_enabled": True, "nearfield_z_mm": .25, "nearfield_grid_points": 11,
                  "preview_radiation": False}
    assumptions = {**selection, "section_length_mm": float(length), "edge_gap_mm": float(gap),
                   "coordinate_transform": {"origin_mm": origin.tolist(), "rotation": rotation.tolist()},
                   "ports": ["P1 aggressor near", "P2 aggressor far", "P3 victim near", "P4 victim far"],
                   "terminals": "Synthetic aligned lumped-port markers at the retained segment ends; not source device pads",
                   "reference": "Ideal continuous PEC rectangle; source reference-plane voids/connectivity unproven",
                   "omissions": ["rest of both nets and board", "vias, antipads and other copper layers", "source components and drivers",
                                 "copper conductivity, roughness and thickness", "solder mask", "dielectric dispersion", "measured correlation"],
                   "qualification": "Source-derived local coupled-route scenario; unvalidated, not complete-board SI or compliance"}
    return design, parameters, assumptions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path, default=ROOT / "build/emerge-si/selection.json")
    parser.add_argument("--output", type=Path, default=ROOT / "build/emerge-si")
    parser.add_argument("--python-executable", type=Path, default=ROOT / ".venv-emerge3/Scripts/python.exe")
    parser.add_argument("--board", choices=["marble", "white_rabbit", "all"], default="all")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    selections = json.loads(args.selection.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    registry = ExtensionRegistry()
    registry.discover([ROOT / "extensions"], trusted_roots=[ROOT / "extensions"])
    for name, selection in selections.items():
        if args.board not in ("all", name):
            continue
        design, parameters, assumptions = build_section(name, selection)
        parameters["python_executable"] = str(args.python_executable.resolve())
        preview = registry.invoke("spike.emerge-suite", "emerge-preview", {"design": design, "parameters": parameters})["data"]
        (args.output / f"{name}_simulation.py").write_bytes(preview["script"].encode("utf-8"))
        write(args.output / f"{name}_design.json", design)
        write(args.output / f"{name}_parameters.json", parameters)
        write(args.output / f"{name}_assumptions.json", assumptions)
        write(args.output / f"{name}_preview.json", {key: value for key, value in preview.items() if key != "script"})
        print(f"{name}: prepared {len(preview['case']['ports'])} ports, 64 frequency points", flush=True)
        if args.prepare_only:
            continue
        parameters["expected_generated_script_sha256"] = preview["script_sha256"]
        started = datetime.now(timezone.utc).isoformat()
        result = registry.invoke("spike.emerge-suite", "emerge-si", {"design": design, "parameters": parameters})["data"]["analysis_result"]
        admitted = admit_analysis_result(result, design_binding(design), extension_id="spike.emerge-suite")
        write(args.output / f"{name}_result.json", admitted)
        write(args.output / f"{name}_execution.json", {"started_utc": started, "finished_utc": datetime.now(timezone.utc).isoformat(),
              "script_sha256": preview["script_sha256"], "solver": result["provenance"]["solver"],
              "status": result["status"], "model_status": result["model_status"], "admission": "passed"})
        print(f"{name}: actual EMerge run {result['status']}, {result['model_status']}", flush=True)


if __name__ == "__main__":
    main()
