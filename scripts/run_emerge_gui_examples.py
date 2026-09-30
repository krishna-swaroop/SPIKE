# SPDX-License-Identifier: Apache-2.0
"""Reproduce real EMerge examples and render admitted results for inspection.

These are execution examples, not converged or measured antenna qualifications.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import html
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from python.spike_core.extension_analysis_results import admit_analysis_result
from python.spike_core.extensions import ExtensionRegistry
from python.spike_core.kicad_importer import import_kicad_design
from run_emerge_antenna_example import run
import run_esp32_rf_surrogate as surrogate

OUTPUT = ROOT / "examples/emerge/gui_workflow"


def prepare(prefix: str, design: dict, parameters: dict) -> None:
    """Save the public preview before execution, binding it to the GUI case."""
    registry = ExtensionRegistry()
    registry.discover([ROOT / "extensions"], trusted_roots=[ROOT / "extensions"])
    preview = registry.invoke("spike.emerge-suite", "emerge-preview",
                              {"design": design, "parameters": parameters})["data"]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / f"{prefix}_simulation.py").write_bytes(preview["script"].encode("utf-8"))
    (OUTPUT / f"{prefix}_preview.json").write_text(json.dumps(
        {key: value for key, value in preview.items() if key != "script"}, indent=2) + "\n", encoding="utf-8")


def board_run(prefix: str, config_path: Path, executable: Path) -> None:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    design = json.loads(json.dumps(import_kicad_design(str(ROOT / config["board"])).to_dict(), allow_nan=False))
    prepare(prefix, design, config["parameters"])
    run(config_path, executable, output_dir=OUTPUT, output_prefix=prefix)


def render() -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    sections = []
    records = []
    for prefix, label in (("patch", "Original Apache-2.0 patch PCB"),
                          ("radome", "Original Apache-2.0 patch PCB with dielectric slab"),
                          ("esp32_surrogate", "uysan iot-esp-eth, CERN-OHL-P-2.0: explicit RF surrogate"),
                          ("patch_fields", "Original patch PCB: dielectric loss and near-field plane")):
        path = OUTPUT / f"{prefix}_result.json"
        if not path.exists():
            continue
        result = json.loads(path.read_text(encoding="utf-8"))
        provenance = result["provenance"]
        binding = {"design_id": provenance["design_id"],
                   "digest_sha256": provenance["design_digest_sha256"]}
        admitted = admit_analysis_result(result, binding, extension_id="spike.emerge-suite")
        script_path = OUTPUT / f"{prefix}_simulation.py"
        script_hash = hashlib.sha256(script_path.read_bytes()).hexdigest() if script_path.exists() else None
        if script_hash is not None and provenance.get("generated_script_sha256") != script_hash:
            raise ValueError(f"{prefix}: executed source hash does not match saved GUI preview")
        records.append({"example": prefix, "solver": provenance["solver"],
                        "result_written_utc": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                        "result_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "status": admitted["status"], "model_status": admitted["model_status"],
                        "admission": "passed", "design_binding": binding,
                        "preview_matches_executed_script": script_hash is not None,
                        "generated_script_sha256": script_hash})
        (OUTPUT / f"{prefix}_admitted_result.json").write_text(
            json.dumps(admitted, indent=2) + "\n", encoding="utf-8")
        network = admitted["networks"]["s_parameters"]
        radiation = admitted["fields"]["radiation"]
        pattern = radiation["patterns_3d"][0]
        theta, phi = np.meshgrid(np.radians(pattern["theta_deg"]),
                                 np.radians(pattern["phi_deg"]), indexing="ij")
        db = np.array(pattern["relative_amplitude_db"]).reshape(theta.shape)
        radius = 10 ** (db / 20)
        figure = plt.figure(figsize=(8, 6), constrained_layout=True)
        axis = figure.add_subplot(projection="3d")
        axis.plot_surface(radius * np.sin(theta) * np.cos(phi),
                          radius * np.sin(theta) * np.sin(phi), radius * np.cos(theta),
                          facecolors=plt.cm.viridis(np.clip((db + 40) / 40, 0, 1)))
        axis.set(xlabel="X", ylabel="Y", zlabel="Z",
                 title=f"{label}\n{pattern['frequency_hz'] / 1e9:g} GHz, normalized E amplitude")
        axis.set_box_aspect((1, 1, 1))
        figure.savefig(OUTPUT / f"{prefix}_sphere.png", dpi=140)
        plt.close(figure)
        s11 = [20 * np.log10(max(np.hypot(*matrix[0][0]), 1e-30)) for matrix in network["values"]]
        figure, axes = plt.subplots(1, 2, figsize=(10, 4), constrained_layout=True)
        axes[0].plot(np.array(network["frequencies_hz"]) / 1e9, s11, marker="o")
        axes[0].set(xlabel="Frequency (GHz)", ylabel="S11 (dB)", title="Port reflection")
        for cut in radiation["cuts"]:
            axes[1].plot(cut["angles_deg"], cut["relative_amplitude_db"],
                         label=f"{cut['frequency_hz'] / 1e9:g} GHz")
        axes[1].set(xlabel="Theta (degrees), phi = 0", ylabel="Relative E amplitude (dB)", title="Radiation cuts")
        axes[1].legend()
        for axis in axes:
            axis.grid(True)
        figure.savefig(OUTPUT / f"{prefix}_analysis.png", dpi=140)
        plt.close(figure)
        peak = int(np.argmax(db))
        ti, pi = divmod(peak, len(pattern["phi_deg"]))
        probe = {"sample_kind": "solver_angular_grid_point", "frequency_hz": pattern["frequency_hz"],
                 "theta_deg": pattern["theta_deg"][ti], "phi_deg": pattern["phi_deg"][pi],
                 "relative_amplitude_db": pattern["relative_amplitude_db"][peak],
                 "e_theta_v_m": pattern["e_theta_v_m"][peak], "e_phi_v_m": pattern["e_phi_v_m"][peak]}
        (OUTPUT / f"{prefix}_probe.json").write_text(json.dumps(probe, indent=2) + "\n", encoding="utf-8")
        warnings = "\n".join(f"{issue['code']}: {issue.get('message', '')}" for issue in admitted["issues"])
        extra = ""
        if prefix == "esp32_surrogate":
            extra = (OUTPUT / "esp32_surrogate_assumptions.json").read_text(encoding="utf-8")
        nearfield_html = ""
        if "nearfield" in admitted["fields"]:
            plane = admitted["fields"]["nearfield"]["planes"][0]
            coords = np.array(plane["coordinates_mm"])
            magnitudes = {}
            for key in ("e_v_m", "h_a_m"):
                magnitudes[key] = np.array([np.linalg.norm(np.array(vector)) if valid else np.nan
                                            for vector, valid in zip(plane[key], plane["valid"])])
            figure, axes = plt.subplots(1, 2, figsize=(10, 4), constrained_layout=True)
            for axis, key, units in zip(axes, ("e_v_m", "h_a_m"), ("V/m", "A/m")):
                plot = axis.pcolormesh(coords[:, 0].reshape(plane["grid_shape"]),
                                       coords[:, 1].reshape(plane["grid_shape"]),
                                       magnitudes[key].reshape(plane["grid_shape"]), shading="nearest")
                axis.set(xlabel="X (mm)", ylabel="Y (mm)", aspect="equal",
                         title=f"|{'E' if key == 'e_v_m' else 'H'}| at {plane['frequency_hz'] / 1e9:g} GHz, z={coords[0, 2]:g} mm")
                figure.colorbar(plot, ax=axis, label=units)
            figure.savefig(OUTPUT / f"{prefix}_nearfield.png", dpi=140)
            plt.close(figure)
            peak = int(np.nanargmax(magnitudes["e_v_m"]))
            field_probe = {"sample_kind": "solver_fem_interpolation_at_explicit_coordinate",
                           "frequency_hz": plane["frequency_hz"], "coordinate_mm": plane["coordinates_mm"][peak],
                           "e_v_m": plane["e_v_m"][peak], "h_a_m": plane["h_a_m"][peak],
                           "electric_magnitude_v_m": float(magnitudes["e_v_m"][peak]),
                           "magnetic_magnitude_a_m": float(magnitudes["h_a_m"][peak]),
                           "valid_samples": sum(plane["valid"]), "total_samples": len(plane["valid"])}
            (OUTPUT / f"{prefix}_nearfield_probe.json").write_text(json.dumps(field_probe, indent=2) + "\n", encoding="utf-8")
            nearfield_html = (f'<h3>Solved near-field plane and peak sampled E probe</h3><img src="{prefix}_nearfield.png" alt="Solved E and H plane">'
                              f"<pre>{html.escape(json.dumps(field_probe, indent=2))}</pre><p>Invalid samples remain gaps. "
                              "Complex component norms use the solver excitation; they do not indicate safety limits or measurement agreement.</p>")
        sections.append(f"<section><h2>{html.escape(label)}</h2><p>Status: {html.escape(admitted['status'])}; "
                        f"model: {html.escape(admitted['model_status'])}. Admission passed SPIKE's contract checks.</p>"
                        f'<img src="{prefix}_sphere.png" alt="Sampled radiation sphere"><img src="{prefix}_analysis.png" alt="S11 and radiation cuts">'
                        f"<h3>Angular probe (sampled, no interpolation)</h3><pre>{html.escape(json.dumps(probe, indent=2))}</pre>"
                        f"<h3>Solver provenance</h3><pre>{html.escape(json.dumps(provenance, indent=2))}</pre>"
                        f"<h3>Warnings</h3><pre>{html.escape(warnings)}</pre><pre>{html.escape(extra)}</pre>"
                        f"{nearfield_html}"
                        f'<p><a href="{prefix}_simulation.py">Exact GUI-generated simulation source</a> · '
                        f'<a href="{prefix}_preview.json">Prepared model</a> · '
                        f'<a href="{prefix}_result.json">Raw result</a> · <a href="{prefix}_admitted_result.json">SPIKE-admitted result</a></p></section>')
    body = ("<!doctype html><html lang='en'><meta charset='utf-8'><title>SPIKE EMerge execution examples</title>"
            "<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:0 20px}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:16px}section{border-top:1px solid #aaa;margin-top:30px}</style>"
            f"<h1>SPIKE EMerge: fresh board simulations</h1><p>Report generated {datetime.now(timezone.utc).isoformat()}.</p>"
            "<p>Real solver output; execution evidence only. No mesh convergence, measurement correlation or calibrated gain. "
            "Plots show normalized electric-field amplitude, not realized gain, efficiency or compliance. "
            "A successful admission proves the data contract, not physical accuracy.</p>"
            "<p>Patch and radome geometry: SPIKE contributors, original Apache-2.0 fixtures. ESP32 board: uysan, "
            "<a href='https://github.com/uysan/iot-esp-eth'>iot-esp-eth</a>, CERN-OHL-P-2.0; retain "
            "<a href='../../esp32/source/LICENSE.md'>source license</a> and notices. The ESP32 result uses a disclosed "
            "two-conductor RF surrogate, not the complete four-layer source board.</p>" + "".join(sections) + "</html>")
    (OUTPUT / "report.html").write_text(body, encoding="utf-8")
    (OUTPUT / "execution_manifest.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--python-executable", type=Path, default=ROOT / ".venv-emerge3/Scripts/python.exe")
    args = parser.parse_args()
    if not args.render_only:
        board_run("patch", ROOT / "examples/emerge/antenna_run.json", args.python_executable)
        board_run("radome", ROOT / "examples/emerge/radome/antenna_with_radome_run.json", args.python_executable)
        design, parameters, _ = surrogate.build_surrogate()
        prepare("esp32_surrogate", design, parameters)
        surrogate.OUTPUT = OUTPUT
        saved = sys.argv
        try:
            sys.argv = ["run", "--run", "--python-executable", str(args.python_executable), "--output-prefix", "esp32_surrogate"]
            surrogate.main()
        finally:
            sys.argv = saved
        board_run("patch_fields", OUTPUT / "patch_fields_run.json", args.python_executable)
    render()
    print(OUTPUT / "report.html")


if __name__ == "__main__":
    main()
