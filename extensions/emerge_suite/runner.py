# SPDX-License-Identifier: Apache-2.0
"""Execute a generated planar PCB case with a separately installed EMerge."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from extensions.emerge_suite.capture import nearfield_plane, s_parameters, sphere_pattern, theta_cut
from extensions.emerge_suite.mesh_capture import capture_mesh


MM = 0.001
C0 = 299_792_458.0


def run_case(case: dict, em, *, radiation: bool, mesh_only: bool = False) -> dict:
    if case.get("contract") != "spike/emerge-board-case/v1":
        raise ValueError("Unsupported EMerge board case.")
    import numpy as np

    native_gerber = case.get("source_format") == "emerge-gerber"
    if native_gerber and case.get("native_gerber_drills"):
        raise ValueError("Retained Excellon drills are not admitted by the native Gerber runner.")
    model = em.Simulation("SPIKE_board")
    if case.get("sparse_solver") == "superlu":
        model.mw.solveroutine.set_solver(em.EMSolver.SUPERLU)
    thickness = case["dielectric_thickness_mm"]
    copper = case.get("copper_layers", [{"name": "F.Cu", "z_mm": 0}, {"name": "B.Cu", "z_mm": -thickness}])
    kwargs = {"zs": np.asarray([layer["z_mm"] for layer in reversed(copper)])} if len(copper) > 2 else {}
    pcb_type = em.geo.PCBNew
    if native_gerber:
        try:
            from emerge.beta.gerber import FileBasedPCB
        except (ImportError, ModuleNotFoundError) as error:
            raise RuntimeError(
                "Native Gerber loading is unavailable. Install emerge[gerber] in the selected solver Python environment."
            ) from error
        pcb_type = FileBasedPCB
    pcb = pcb_type(thickness, unit=MM, layers=len(copper),
                   material=em.Material(case["epsilon_r"], tand=case["dielectric_layers"][0]["loss_tangent"] if case.get("include_dielectric_loss") else 0),
                   trace_material=em.lib.PEC, **kwargs)
    layer_indices = {layer["name"]: len(copper)-1-index for index, layer in enumerate(copper)}
    polygons = case["polygons"]
    geometry_version = None
    if case.get("geometry_backend") == "emcad":
        try:
            import emcad as cad
        except ImportError as error:
            raise RuntimeError("EMCAD geometry was selected but emcad is unavailable in the EMerge interpreter.") from error
        from importlib.metadata import version
        from extensions.emerge_suite.emcad_geometry import merge_copper
        polygons = merge_copper(polygons, cad)
        geometry_version = version("emcad")
    native_surfaces = []
    if native_gerber:
        with tempfile.TemporaryDirectory(prefix="spike-emerge-gerber-") as directory:
            source_root = Path(directory)
            for layer in case["native_gerber_layers"]:
                source_path = source_root / layer["file_name"]
                source_path.write_bytes(layer["content"].encode("utf-8"))
                native_surfaces.append(pcb.layer_from_file(
                    layer_indices[layer["name"]], str(source_path),
                    res_mm=case["gerber_resolution_mm"], simplify=True))
    else:
        for polygon in polygons:
            layer_index = layer_indices[polygon["layer"]]
            if int(str(em.__version__).split(".", 1)[0]) >= 3:
                pcb.add_poly(polygon["xs_mm"], polygon["ys_mm"], layer=layer_index,
                             name=f"SPIKE_{polygon['id']}")
            else:
                pcb.add_poly(polygon["xs_mm"], polygon["ys_mm"], z=pcb.z(layer_index),
                             name=f"SPIKE_{polygon['id']}")
    traces = native_surfaces if native_gerber else pcb.compile_paths(
        merge=False, fragment=case.get("fragment_copper", True))
    for via in case.get("shorting_vias", []):
        pcb.add_vias((via["x_mm"], via["y_mm"]), radius=via["radius_mm"])
    pcb.set_bounds(*case["bounds_mm"])
    if len(copper) == 2:
        pcb.generate_pcb(split_z=True, merge=True)
    else:
        xmin, ymin, xmax, ymax = case["bounds_mm"]
        for layer in case["dielectric_layers"]:
            solid = em.geo.Box((xmax-xmin)*MM, (ymax-ymin)*MM,
                               layer["thickness_mm"]*MM,
                               position=(xmin*MM, ymin*MM, layer["z_bottom_mm"]*MM),
                               name=layer["name"])
            solid.set_material(em.Material(layer["epsilon_r"], tand=layer["loss_tangent"] if case.get("include_dielectric_loss") else 0))
    shorts = pcb.generate_vias(merge=False) if case.get("shorting_vias") else []
    surroundings = []
    for item in case.get("surrounding_geometry", []):
        origin = [coordinate * MM for coordinate in item["origin_mm"]]
        size = [extent * MM for extent in item["size_mm"]]
        solid = em.geo.Box(*size, position=tuple(origin), name=item["name"])
        solid.set_material(em.Material(item["epsilon_r"]))
        surroundings.append(solid)
    # A bounded default for the absorbing region; the cap is recorded by the
    # adapter as an approximation and must be studied for convergence.
    margin_m = min(max(C0 / case["frequency_stop_hz"] / 4, 0.02), 0.1)
    if case.get("air_margin_mm") is not None:
        margin_m = case["air_margin_mm"] * MM
    air = em.geo.open_region(margin_m, margin_m, margin_m).background()
    ports = []
    for port in case["ports"]:
        width_m = port["width_mm"] * MM
        ports.append(em.geo.Plate(
            np.asarray([(port["x_mm"] - port["width_mm"] / 2) * MM,
                        port["y_mm"] * MM, port.get("z_bottom_mm", -thickness) * MM]),
            np.asarray([width_m, 0, 0]),
            np.asarray([0, 0, port["height_mm"] * MM]),
        ))
    model.mw.set_frequency_range(case["frequency_start_hz"],
                                 case["frequency_stop_hz"], case["frequency_points"])
    model.commit_geometry()
    mesh_m = case["mesh_resolution_mm"] * MM
    if native_gerber:
        for surface in traces:
            model.mesher.set_boundary_size(surface, mesh_m)
    else:
        model.mesher.set_boundary_size(traces, mesh_m)
    for short in shorts:
        model.mesher.set_boundary_size(short, mesh_m)
    for solid in surroundings:
        model.mesher.set_boundary_size(solid, mesh_m)
    for plate, port in zip(ports, case["ports"]):
        model.mesher.set_face_size(plate, min(mesh_m, port["width_mm"] * MM / 3))
    model.generate_mesh()
    if mesh_only:
        return {"engine_version": str(em.__version__), "mesh": capture_mesh(model.mesh),
                "air_margin_m": margin_m, "geometry_backend": case.get("geometry_backend", "emerge"),
                "geometry_backend_version": geometry_version,
                "copper_polygon_count": None if native_gerber else len(polygons),
                "native_gerber_layer_count": len(native_surfaces) if native_gerber else None}
    for index, (plate, port) in enumerate(zip(ports, case["ports"]), 1):
        model.mw.bc.LumpedPort(plate, index, width=port["width_mm"] * MM,
                               height=port["height_mm"] * MM, direction=em.ZAX,
                               Z0=port["reference_impedance_ohm"])
    boundary = air.boundary()
    model.mw.bc.AbsorbingBoundary(boundary)
    data = model.mw.run_sweep(parallel=case.get("parallel", False), n_workers=case.get("n_workers", 2))
    port_names = [f"P{index}" for index in range(1, len(ports) + 1)]
    result = {"engine_version": str(em.__version__),
              "s_parameters": s_parameters(data, port_names, case.get("reference_impedance_ohm", 50.0)),
              "air_margin_m": margin_m}
    result["geometry_backend"] = case.get("geometry_backend", "emerge")
    result["geometry_backend_version"] = geometry_version
    result["copper_polygon_count"] = None if native_gerber else len(polygons)
    if native_gerber:
        result["native_gerber_layer_count"] = len(native_surfaces)
    fields = {}
    excited_port = case.get("field_excited_port", 1)
    coefficients = [1 + 0j if index + 1 == excited_port else 0j for index in range(len(ports))]
    excitation = {"excitation_port": port_names[excited_port - 1], "excitation_ports": port_names,
                  "excitation_coefficients": [[float(v.real), float(v.imag)] for v in coefficients],
                  "excitation_normalization": "EMerge port coefficient convention; no voltage or power calibration claimed"}
    if radiation or case.get("nearfield_enabled"):
        for frequency in result["s_parameters"]["frequencies_hz"]:
            field = data.field.find(freq=frequency)
            field.set_excitations(*coefficients)
            fields[frequency] = field
    if radiation:
        frequencies = result["s_parameters"]["frequencies_hz"]
        angles = [float(value) for value in range(0, 181, 5)]
        cuts = [theta_cut(fields[frequency], boundary,
                          frequency, angles, phi_deg=case.get("radiation_cut_phi_deg", 0.0))
                for frequency in frequencies]
        theta = [float(value) for value in range(0, 181, case.get("radiation_theta_step_deg", 15))]
        phi = [float(value) for value in range(0, 361, case.get("radiation_phi_step_deg", 15))]
        patterns = [sphere_pattern(fields[frequency], boundary,
                                   frequency, theta, phi)
                    for frequency in frequencies]
        result["radiation"] = {"frequencies_hz": frequencies, "cuts": cuts, **excitation,
                               "patterns_3d": patterns}
    if case.get("nearfield_enabled"):
        frequencies = result["s_parameters"]["frequencies_hz"]
        result["nearfield"] = {"frequencies_hz": frequencies, **excitation, "planes": [
            nearfield_plane(fields[frequency], frequency, case["bounds_mm"],
                            case["nearfield_z_mm"], case["nearfield_grid_points"])
            for frequency in frequencies]}
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--radiation", action="store_true")
    args = parser.parse_args()
    case = json.loads(Path(args.case).read_text(encoding="utf-8"),
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    import emerge as em

    result = run_case(case, em, radiation=args.radiation)
    output = Path(args.result)
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, output)


if __name__ == "__main__":
    main()
