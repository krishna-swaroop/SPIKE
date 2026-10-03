# SPDX-License-Identifier: Apache-2.0
"""Render scientific plots from executed acceptance artifacts, never UI mocks."""
import hashlib
import json
import re
from pathlib import Path
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "build/multiboard-acceptance-20261001/em"
OUT = ROOT / "build/multiboard-acceptance-20261001/screenshots"
OUT.mkdir(parents=True, exist_ok=True)
HASHES = {}
plt.rcParams.update({"font.size": 11, "axes.titlesize": 13, "figure.facecolor": "#f4f7fb", "axes.facecolor": "white", "axes.grid": True, "grid.alpha": .2})


def read(relative):
    path = DATA / relative
    payload = path.read_bytes()
    HASHES[str(path.relative_to(ROOT))] = hashlib.sha256(payload).hexdigest()
    return json.loads(payload)


def finite(values):
    value = np.asarray(values)
    if not np.isfinite(value).all():
        raise ValueError("Nonfinite scientific plot input")
    return value


def response(ax, loaded):
    for name, color in (("next", "#176ac5"), ("fext", "#cc4d30")):
        rows = loaded["frequency_response"][name]["trace"]
        f = finite([row["frequency_hz"] for row in rows]) * 1e-9
        db = 20 * np.log10(np.maximum(finite([row["magnitude"] for row in rows]), 1e-6))
        ax.plot(f, db, label=name.upper(), color=color, linewidth=2)
    ax.set(xlabel="Frequency (GHz)", ylabel="Loaded voltage transfer (dB V/V)", ylim=(-120, 0))
    ax.legend()


def si():
    extracted = read("esp32-source-si-graph/extraction.json")
    loaded = read("esp32-source-si-graph/loaded-crosstalk.json")
    report = read("esp32-source-si-graph/report.json")
    assert loaded["status"] == report["status"].replace("executed", "completed")
    fig, axes = plt.subplots(2, 2, figsize=(15, 11.5))
    fig.subplots_adjust(left=.08, right=.96, top=.88, bottom=.19, hspace=.38, wspace=.30)
    fig.suptitle("Source-derived multi-board SI: two ESP32 occurrences + authored connector", fontsize=19, fontweight="bold", y=.96)
    fig.text(.5, .918, "Actual pinned KiCad copper overlap extraction and one shared four-port network solve • experimental", ha="center", fontsize=12)
    time = loaded["time_domain"]
    assert time["status"] == "completed"
    t = finite(time["time_s"]) * 1e9
    axes[0, 0].plot(t, finite(time["source_v"]), color="#237943", linewidth=2)
    axes[0, 0].set(title="Authored 3.3 V Thevenin pulse", xlabel="Time (ns)", ylabel="Source voltage (V)")
    for name, color in (("next", "#176ac5"), ("fext", "#cc4d30")):
        signal = finite(time[f"{name}_v"]) * 1000
        assert len(signal) == len(t)
        axes[0, 1].plot(t, signal, label=f"{name.upper()} peak {np.max(np.abs(signal)):.3f} mV", color=color, linewidth=1.8)
    axes[0, 1].set(title="Computed victim response • 50 Ω terminations", xlabel="Time (ns)", ylabel="Victim voltage (mV)")
    axes[0, 1].legend()
    response(axes[1, 0], loaded)
    axes[1, 0].set_title("Frequency-domain loaded interference")
    ax = axes[1, 1]
    ax.axis("off")
    rlc = extracted["rlgc_per_m"]
    c = finite(rlc["capacitance_f_per_m"]) * 1e12
    l = finite(rlc["inductance_h_per_m"]) * 1e9
    ax.text(0, 1, "Model and extraction evidence", fontsize=14, fontweight="bold", va="top")
    content = ("Board A overlap → 10 mm connector → Board B overlap\n\n"
               "Each board: 0.7874 mm ERXD0 / ERXD1 parallel overlap\n"
               "Trace width / edge gap: 0.254 / 0.254 mm\n"
               "Imported In1.Cu reference spacing: 0.2454 mm\n\n"
               f"Capacitance matrix (pF/m):  [{c[0,0]:.3f}, {c[0,1]:.3f}]\n"
               f"                                              [{c[1,0]:.3f}, {c[1,1]:.3f}]\n"
               f"Inductance matrix (nH/m):  [{l[0,0]:.3f}, {l[0,1]:.3f}]\n"
               f"                                              [{l[1,0]:.3f}, {l[1,1]:.3f}]\n\n"
               "Connector: synthetic RLGC; R = 10 Ω/m, L = 250 nH/m,\n"
               "C = 100 pF/m; no mutual coupling in connector\n"
               f"Cross-section mesh matrix change: {100*extracted['cross_section']['latest_relative_matrix_change']:.3f}%\n"
               f"Reciprocity error: {report['reciprocity_max_error']:.2e}")
    ax.text(0, .88, content, va="top", fontsize=10.5, linespacing=1.32)
    fig.text(.08, .063, "Scope: exact clipped source overlap only; remaining routes, bends, vias and full boards are excluded.\nNetwork coupling does not calculate spatial inter-board fields. Full imported-assembly EM lowering is unsupported.", fontsize=11, color="#754010", linespacing=1.6)
    path = OUT / "multiboard-si-extraction-interference.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def boxes(ax, raw):
    faces = ((0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5))
    for board in raw["boards"]:
        for box in board["boxes"]:
            low, high = box["start_mm"], box["stop_mm"]
            corners = [[x, y, z] for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]
            color = "#26a47c" if box["kind"] == "dielectric" else "#e0a331"
            ax.add_collection3d(Poly3DCollection([[corners[i] for i in face] for face in faces], facecolors=color, alpha=.40 if box["kind"] == "dielectric" else .8, linewidths=.3, edgecolors="#3b555f"))
    ax.set(xlim=(-22, 22), ylim=(-12, 12), zlim=(-2, 7), xlabel="X (mm)", ylabel="Y (mm)", zlabel="Z (mm)")
    ax.set_box_aspect((44, 24, 15))
    ax.view_init(elev=24, azim=-60)


def em():
    field = read("box-field-extension-source/field-result.json")
    execution = read("box-field-extension-source/execution.json")
    screen = read("box-field-extension-source/screening.json")
    loaded = read("box-field-extension-source/loaded-field-crosstalk.json")
    raw = read("box-field-extension-source/geometry.json")
    log_path = DATA / "box-field-extension-source/solver.log"
    log_bytes = log_path.read_bytes()
    HASHES[str(log_path.relative_to(ROOT))] = hashlib.sha256(log_bytes).hexdigest()
    engine_cells = [int(float(value)) for value in re.findall(r"FDTD simulation size:[^\n]*?-->\s*([\d.]+) FDTD cells", log_bytes.decode("utf-8"))]
    assert len(engine_cells) == 4 and len(set(engine_cells)) == 1
    assert execution["status"] == field["status"] == "executed"
    assert screen["screen_passed"] and loaded["source_field_sha256"] == execution["artifact_sha256"]["field-result.json"]
    f = finite(field["frequency_hz"]) * 1e-9
    s = finite(field["s_real"]) + 1j * finite(field["s_imag"])
    assert s.shape == (len(f), 4, 4)
    fig = plt.figure(figsize=(15, 11.5))
    fig.subplots_adjust(left=.08, right=.96, top=.88, bottom=.19, hspace=.35, wspace=.32)
    fig.suptitle("Actual OpenEMS multi-board field coupling • two-substrate box benchmark", fontsize=18, fontweight="bold", y=.96)
    fig.text(.5, .918, "Four independent FDTD excitations • separate board returns • 4 mm air gap • 101 frequency points", ha="center", fontsize=12)
    geometry = fig.add_subplot(221, projection="3d")
    boxes(geometry, raw)
    geometry.set_title("Executed solver geometry (synthetic boxes)")
    ax = fig.add_subplot(222)
    for row, name, color in ((2, "S31: board A near → board B near", "#176ac5"), (3, "S41: board A near → board B far", "#cc4d30")):
        ax.plot(f, 20*np.log10(np.maximum(np.abs(s[:,row,0]), 1e-12)), label=name, color=color, linewidth=2)
    ax.set(title="Solved cross-board scattering response", xlabel="Frequency (GHz)", ylabel="Scattering magnitude (dB)")
    ax.legend(fontsize=10)
    ax = fig.add_subplot(223)
    response(ax, loaded)
    ax.set_ylim(-65, -15)
    ax.set_title("Computed coupling • explicit 50 Ω source / loads")
    ax = fig.add_subplot(224)
    ax.axis("off")
    ax.text(0, 1, "Actual execution and numerical screens", fontsize=14, fontweight="bold", va="top")
    content = (f"OpenEMS {field['solver_version']} • wall time {execution['elapsed_s']:.2f} s\n"
               f"Pre-run recorded mesh cells: {field['meshes'][0]['cells']:,}\n"
               f"Executed engine log: {engine_cells[0]:,} cells per excitation\n"
               "Frequency band: 0.2–3.0 GHz; reference 50 Ω\n"
               "All four pulse / energy completion screens passed\n"
               "Observed terminal energy decay: at least 70 dB\n\n"
               f"Maximum S singular value: {field['maximum_singular_value']:.8f}\n"
               f"Absolute reciprocity error: {field['maximum_reciprocity_absolute_error']:.6f}\n"
               f"Cross-board |S31| peak: {field['crossboard_s31_peak_magnitude']:.6f}\n\n"
               "Numerical sanity thresholds: passivity excess 0.02,\n"
               "reciprocity absolute error 0.02 — passed\n"
               "Loaded coupling remains frequency-only: no DC data\n"
               "Port polarity preserved; no phase / passivity repair")
    ax.text(0, .88, content, va="top", fontsize=10.5, linespacing=1.32)
    fig.text(.08, .065, "Scope: synthetic substrate / trace / return boxes; imported full-board assembly field lowering is unsupported.\nOne mesh / PML / duration setting only. Sanity screens do not establish convergence, RF copper-loss accuracy or physical qualification.", fontsize=11, color="#754010", linespacing=1.6)
    path = OUT / "multiboard-openems-field-coupling.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


if __name__ == "__main__":
    images = [si(), em()]
    manifest = {"source_artifact_sha256": HASHES, "images": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in images}, "production_qualified": False}
    (OUT / "multiboard-scientific-plots-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps([str(path) for path in images], indent=2))
