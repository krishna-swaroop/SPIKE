# SPDX-License-Identifier: Apache-2.0
"""SPIKE GUI-generated EMerge model; results remain unvalidated.
Run with the selected EMerge Python interpreter: simulation.py --result result.json
Only declared GUI settings define the model. No network access is requested.
"""
from __future__ import annotations
import json
MAX_POLYGONS = 4096
MAX_VERTICES = 200000
CASE = {'air_margin_mm': None,
 'attributed_graphic_polygon_ids': [],
 'bounds_mm': [100.0, 100.0, 140.0, 130.0],
 'contract': 'spike/emerge-board-case/v1',
 'copper_layers': [{'name': 'F.Cu', 'z_mm': -0.0}, {'name': 'B.Cu', 'z_mm': -1.6}],
 'dielectric_layers': [{'epsilon_r': 4.3,
                        'loss_tangent': 0.02,
                        'name': 'dielectric 1',
                        'thickness_mm': 1.6,
                        'z_bottom_mm': -1.6,
                        'z_top_mm': -0.0}],
 'dielectric_thickness_mm': 1.6,
 'epsilon_r': 4.3,
 'field_excited_port': 1,
 'fragment_copper': True,
 'frequency_points': 2,
 'frequency_start_hz': 3400000000.0,
 'frequency_stop_hz': 3600000000.0,
 'geometry_backend': 'emerge',
 'geometry_status': 'approximate_rectangular_surface_pec',
 'idealized_reference_plane_ids': [],
 'include_dielectric_loss': True,
 'layered_cell_estimate': 300,
 'loss_tangent_omitted': 0,
 'mesh_resolution_mm': 2.0,
 'modeled_nets': ['RF', 'GND'],
 'n_workers': 2,
 'nearfield_enabled': True,
 'nearfield_grid_points': 11,
 'nearfield_z_mm': 1.0,
 'parallel': False,
 'planar_cell_estimate': 300,
 'polygons': [{'id': '51d0c420-4c7b-4da5-b9ec-001000000021',
               'layer': 'F.Cu',
               'net': 'RF',
               'xs_mm': [105.0, 110.0, 110.0, 105.0],
               'ys_mm': [116.0, 116.0, 114.0, 114.0]},
              {'id': '51d0c420-4c7b-4da5-b9ec-001000000011',
               'layer': 'F.Cu',
               'net': 'RF',
               'xs_mm': [104.0, 106.0, 106.0, 104.0],
               'ys_mm': [114.0, 114.0, 116.0, 116.0]},
              {'id': '51d0c420-4c7b-4da5-b9ec-001000000012',
               'layer': 'B.Cu',
               'net': 'GND',
               'xs_mm': [104.0, 106.0, 106.0, 104.0],
               'ys_mm': [114.0, 114.0, 116.0, 116.0]},
              {'id': '51d0c420-4c7b-4da5-b9ec-001000000041:F.Cu:1',
               'layer': 'F.Cu',
               'net': 'RF',
               'xs_mm': [110.0, 130.0, 130.0, 110.0],
               'ys_mm': [105.0, 105.0, 125.0, 125.0]},
              {'id': '51d0c420-4c7b-4da5-b9ec-001000000051:B.Cu:1',
               'layer': 'B.Cu',
               'net': 'GND',
               'xs_mm': [100.25, 139.75, 139.75, 100.25],
               'ys_mm': [100.25, 100.25, 129.75, 129.75]}],
 'ports': [{'height_mm': 1.6,
            'reference_impedance_ohm': 50.0,
            'return_layer': 'B.Cu',
            'return_pad_id': '51d0c420-4c7b-4da5-b9ec-001000000012',
            'signal_layer': 'F.Cu',
            'signal_pad_id': '51d0c420-4c7b-4da5-b9ec-001000000011',
            'width_mm': 1.0,
            'x_mm': 105.0,
            'y_mm': 115.0,
            'z_bottom_mm': -1.6}],
 'radiation_cut_phi_deg': 0.0,
 'radiation_phi_step_deg': 15,
 'radiation_theta_step_deg': 15,
 'reference_impedance_ohm': 50.0,
 'shorting_vias': [],
 'sparse_solver': 'auto'}
RADIATION_REQUESTED = True
# SPIKE-owned capture adapter
import math

def _pair(value: complex) -> list[float]:
    return [float(value.real), float(value.imag)]

def _electric_farfield(value: object):
    """Read EMerge 2.8 tuples or 3.0 EHFieldFF public Cartesian samples."""
    import numpy as np

    if isinstance(value, tuple) and len(value) == 3:
        return np.asarray(value[0])
    if all(hasattr(value, axis) for axis in ("Ex", "Ey", "Ez")):
        return np.stack([value.Ex, value.Ey, value.Ez], axis=0)
    raise ValueError("EMerge returned an unsupported far-field format.")

def s_parameters(data: object, port_names: list[str], reference_impedance_ohm: float) -> dict:
    """Capture *solved* frequencies via grid.S, without vector-fit interpolation."""
    grid = data.scalar.grid
    frequencies = [float(value) for value in grid.freq]
    matrices = []
    for index in range(len(frequencies)):
        matrices.append([[_pair(grid.S(receive + 1, excited + 1)[index])
                          for excited in range(len(port_names))]
                         for receive in range(len(port_names))])
    return {"frequencies_hz": frequencies, "ports": list(port_names),
            "reference_impedance_ohm": reference_impedance_ohm, "values": matrices}

def theta_cut(field: object, faces: object, frequency_hz: float,
              angles_deg: list[float], *, phi_deg: float = 0.0,
              origin: tuple[float, float, float] | None = None) -> dict:
    """Project EMerge's Cartesian far field onto spherical theta/phi axes.

    EMerge takes radians. Projection uses the standard right-handed spherical
    basis: e_theta=(cos(t)cos(p),cos(t)sin(p),-sin(t)),
    e_phi=(-sin(p),cos(p),0). Input coordinates follow the model's units.
    """
    import numpy as np

    theta = np.asarray([math.radians(float(value)) for value in angles_deg])
    phi = np.full(theta.shape, math.radians(float(phi_deg)))
    electric = _electric_farfield(field.farfield(theta, phi, faces, origin=origin))
    e_theta = []
    e_phi = []
    for index, angle in enumerate(theta):
        ex, ey, ez = (electric[component, index] for component in range(3))
        e_theta.append(_pair(ex * math.cos(angle) * math.cos(phi[index])
                             + ey * math.cos(angle) * math.sin(phi[index])
                             - ez * math.sin(angle)))
        e_phi.append(_pair(-ex * math.sin(phi[index]) + ey * math.cos(phi[index])))
    return {"frequency_hz": float(frequency_hz), "angles_deg": list(angles_deg),
            "phi_deg": float(phi_deg), "e_theta_v_m": e_theta, "e_phi_v_m": e_phi}

def sphere_pattern(field: object, faces: object, frequency_hz: float,
                   theta_deg: list[float], phi_deg: list[float],
                   *, origin: tuple[float, float, float] | None = None) -> dict:
    """Capture solved spherical field samples, theta-major and phi-minor.

    The sampled surface is intentionally coarse and is a visualization of the
    far field returned by EMerge, not an interpolated solver result.
    """
    import numpy as np

    theta = np.asarray([math.radians(t) for t in theta_deg for _ in phi_deg])
    phi = np.asarray([math.radians(p) for _ in theta_deg for p in phi_deg])
    electric = _electric_farfield(field.farfield(theta, phi, faces, origin=origin))
    cos_theta, sin_theta = np.cos(theta), np.sin(theta)
    cos_phi, sin_phi = np.cos(phi), np.sin(phi)
    e_theta = electric[0] * cos_theta * cos_phi + electric[1] * cos_theta * sin_phi - electric[2] * sin_theta
    e_phi = -electric[0] * sin_phi + electric[1] * cos_phi
    return {"frequency_hz": float(frequency_hz), "theta_deg": list(theta_deg),
            "phi_deg": list(phi_deg),
            "e_theta_v_m": [_pair(value) for value in e_theta],
            "e_phi_v_m": [_pair(value) for value in e_phi]}

def nearfield_plane(field: object, frequency_hz: float, bounds_mm: list[float],
                    z_mm: float, grid_points: int) -> dict:
    """Interpolate actual solved complex E/H on an XY plane, in SI units.

    EMerge marks coordinates outside its tetrahedral domain with NaN. Such
    samples are explicitly invalid rather than replaced with inferred zeros.
    """
    import numpy as np

    xs = np.linspace(bounds_mm[0], bounds_mm[2], grid_points)
    ys = np.linspace(bounds_mm[1], bounds_mm[3], grid_points)
    coordinates = [[float(x), float(y), float(z_mm)] for y in ys for x in xs]
    xyz = np.asarray(coordinates) * 0.001
    solved = field.interpolate(xyz[:, 0], xyz[:, 1], xyz[:, 2], usenan=True)
    electric = np.stack([solved.Ex, solved.Ey, solved.Ez], axis=1)
    magnetic = np.stack([solved.Hx, solved.Hy, solved.Hz], axis=1)
    valid = np.all(np.isfinite(electric), axis=1) & np.all(np.isfinite(magnetic), axis=1)
    return {"frequency_hz": float(frequency_hz), "grid_shape": [grid_points, grid_points],
            "coordinates_mm": coordinates, "valid": [bool(value) for value in valid],
            "e_v_m": [[_pair(value) for value in row] if okay else None for row, okay in zip(electric, valid)],
            "h_a_m": [[_pair(value) for value in row] if okay else None for row, okay in zip(magnetic, valid)]}

# SPIKE-owned emcad_geometry adapter
import math

def merge_copper(polygons: list[dict], cad) -> list[dict]:
    groups = {}
    for polygon in polygons:
        groups.setdefault((polygon["net"], polygon["layer"]), []).append(polygon)
    output = []
    vertices = 0
    for (net, layer), rows in groups.items():
        merged = cad.add_polygons(*(cad.Polygon(row["xs_mm"], row["ys_mm"]) for row in rows))
        for index, polygon in enumerate(merged):
            if polygon.holes:
                raise ValueError("EMCAD copper union produced holes unsupported by the surface adapter.")
            xs, ys = list(map(float, polygon.xs)), list(map(float, polygon.ys))
            if len(xs) != len(ys) or len(xs) < 3:
                raise ValueError("EMCAD returned an invalid polygon.")
            if not all(math.isfinite(value) for value in xs + ys):
                raise ValueError("EMCAD returned nonfinite coordinates.")
            vertices += len(xs)
            output.append({"id": f"emcad_{len(output)}_{index}", "net": net,
                           "layer": layer, "xs_mm": xs, "ys_mm": ys})
            if len(output) > MAX_POLYGONS or vertices > MAX_VERTICES:
                raise ValueError("EMCAD output exceeds the copper geometry budget.")
    if not output:
        raise ValueError("EMCAD returned empty selected copper.")
    return output

# SPIKE-owned runner adapter
import argparse

import json

import math

import os

from pathlib import Path

import sys

MM = 0.001

C0 = 299_792_458.0

def run_case(case: dict, em, *, radiation: bool) -> dict:
    if case.get("contract") != "spike/emerge-board-case/v1":
        raise ValueError("Unsupported EMerge board case.")
    import numpy as np

    model = em.Simulation("SPIKE_board")
    if case.get("sparse_solver") == "superlu":
        model.mw.solveroutine.set_solver(em.EMSolver.SUPERLU)
    thickness = case["dielectric_thickness_mm"]
    copper = case.get("copper_layers", [{"name": "F.Cu", "z_mm": 0}, {"name": "B.Cu", "z_mm": -thickness}])
    kwargs = {"zs": np.asarray([layer["z_mm"] for layer in reversed(copper)])} if len(copper) > 2 else {}
    pcb = em.geo.PCBNew(thickness, unit=MM, layers=len(copper),
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
        polygons = merge_copper(polygons, cad)
        geometry_version = version("emcad")
    for polygon in polygons:
        layer_index = layer_indices[polygon["layer"]]
        if str(em.__version__).startswith("3.0."):
            pcb.add_poly(polygon["xs_mm"], polygon["ys_mm"], layer=layer_index,
                         name=f"SPIKE_{polygon['id']}")
        else:
            pcb.add_poly(polygon["xs_mm"], polygon["ys_mm"], z=pcb.z(layer_index),
                         name=f"SPIKE_{polygon['id']}")
    traces = pcb.compile_paths(merge=False, fragment=case.get("fragment_copper", True))
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
    model.mesher.set_boundary_size(traces, mesh_m)
    for short in shorts:
        model.mesher.set_boundary_size(short, mesh_m)
    for solid in surroundings:
        model.mesher.set_boundary_size(solid, mesh_m)
    for plate, port in zip(ports, case["ports"]):
        model.mesher.set_face_size(plate, min(mesh_m, port["width_mm"] * MM / 3))
    model.generate_mesh()
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
    result["copper_polygon_count"] = len(polygons)
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
