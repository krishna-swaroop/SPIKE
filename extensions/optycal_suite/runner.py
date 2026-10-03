# SPDX-License-Identifier: Apache-2.0
"""One-way PEC physical optics using Optycal's public surface API.

No upstream implementation or example source was used. The independent source
adapter interpolates Cartesian complex far-zone coefficients and assumes the
e^(+j omega t) convention, E=F exp(-jkr)/r, H=rhat cross E/Zvac. Optycal evaluates
its separately installed Stratton-Chu surface integrals. Close antenna/structure
coupling, diffraction, shadowing and multiple scattering are not represented.
"""
from __future__ import annotations

import math


def rotation_matrix(degrees):
    import numpy as np
    x, y, z = [math.radians(v) for v in degrees]
    rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    return rz @ ry @ rx


def source_functions(pattern):
    """Return Cartesian E/H callbacks using bilinear complex interpolation.

    Interpolating Cartesian components avoids spherical-vector discontinuities
    at the poles. Projection removes interpolation's small radial component.
    Amplitude remains in arbitrary shared coherent units.
    """
    import numpy as np
    theta = np.deg2rad(pattern["theta_deg"])
    phi = np.deg2rad(pattern["phi_deg"])
    ts, ps = np.meshgrid(theta, phi, indexing="ij")
    et = np.asarray(pattern["e_theta_v_m"], dtype=float)
    ep = np.asarray(pattern["e_phi_v_m"], dtype=float)
    et = (et[:, 0] + 1j * et[:, 1]).reshape(ts.shape)
    ep = (ep[:, 0] + 1j * ep[:, 1]).reshape(ts.shape)
    cart = np.stack((et*np.cos(ts)*np.cos(ps)-ep*np.sin(ps),
                     et*np.cos(ts)*np.sin(ps)+ep*np.cos(ps), -et*np.sin(ts)), axis=0)

    def ff(t, p, k0):
        t, p = np.asarray(t), np.mod(np.asarray(p), 2*math.pi)
        i = np.clip(np.searchsorted(theta, t, side="right")-1, 0, len(theta)-2)
        j = np.clip(np.searchsorted(phi, p, side="right")-1, 0, len(phi)-2)
        a, b = (t-theta[i])/(theta[i+1]-theta[i]), (p-phi[j])/(phi[j+1]-phi[j])
        electric = ((1-a)*(1-b)*cart[:, i, j] + a*(1-b)*cart[:, i+1, j] +
                    (1-a)*b*cart[:, i, j+1] + a*b*cart[:, i+1, j+1])
        direction = np.stack((np.sin(t)*np.cos(p), np.sin(t)*np.sin(p), np.cos(t)))
        electric -= direction * np.sum(direction*electric, axis=0)
        magnetic = np.cross(direction.T, electric.T).T / 376.730313668
        return (*electric, *magnetic)

    def nf(t, p, r, k0):
        # Optycal Antenna.expose_xyz applies the outgoing exp(-jkr)/r factor.
        # Its callback supplies coefficients, not the propagated point field.
        # Independently checked with unit callback fields at two distances.
        return ff(t, p, k0)
    return nf, ff


def _pairs(array):
    import numpy as np
    array = np.asarray(array)
    if not np.all(np.isfinite(array)):
        raise ValueError("Optycal returned non-finite complex fields.")
    return np.stack((array.real, array.imag), axis=-1).tolist()


def illuminated_triangles(vertices, triangles, source_position):
    """Retain only outward faces geometrically facing the source.

    A PEC solid has no illuminated interior face. This front-facing test is
    geometric optics' local visibility condition, not inter-surface ray tracing.
    """
    import numpy as np
    v = vertices[triangles]
    normal = np.cross(v[:, 1]-v[:, 0], v[:, 2]-v[:, 0])
    direction = source_position-np.mean(v, axis=1)
    keep = np.einsum("ij,ij->i", normal, direction) > 0
    retained = triangles[keep]
    if len(retained) == 0:
        raise ValueError("No outward structure face is illuminated by the placed antenna.")
    return retained


def run_case(case):
    import numpy as np
    import optycal as op
    from importlib.metadata import version
    frequency = case["frequency_hz"]
    nf, ff = source_functions(case["source_pattern"])
    rotation = rotation_matrix(case["antenna_rotation_deg"])
    cs = op.CoordinateSystem([0, 0, 0], rotation[:, 0].tolist(), rotation[:, 1].tolist(), rotation[:, 2].tolist())
    position = np.asarray(case["antenna_translation_mm"])*0.001
    antenna = op.Antenna(*position, frequency, cs=cs, nf_pattern=nf, ff_pattern=ff)
    mesh = case["structure_mesh"]
    vertices = np.asarray(mesh["vertices_mm"], dtype=float)*0.001
    triangles = np.asarray(mesh["triangles"], dtype=np.int64)
    triangles = illuminated_triangles(vertices, triangles, position)
    # Optycal's public Mesh coordinate-array convention is component-major.
    surface_mesh = op.Mesh(vertices.T)
    surface_mesh.set_triangles(triangles)
    surface = op.Surface(surface_mesh, op.FRES_PEC, polyorder=1, name="Imported PEC structure")
    antenna.expose_surface(surface)
    theta = np.arange(0, 181, case["theta_step_deg"], dtype=float)
    phi = np.arange(0, 361, case["phi_step_deg"], dtype=float)
    t, p = np.deg2rad(np.repeat(theta, len(phi))), np.deg2rad(np.tile(phi, len(theta)))
    radial = np.stack((np.sin(t)*np.cos(p), np.sin(t)*np.sin(p), np.cos(t)))
    points = case["observation_radius_m"]*radial
    direct = antenna.expose_xyz(*points).E
    scattered = surface.expose_xyz(*points).E
    total = direct + scattered
    for field in (direct, scattered, total):
        if field.shape != (3, len(t)) or not np.all(np.isfinite(field)):
            raise ValueError("Optycal returned invalid observation fields.")
    et_basis = np.stack((np.cos(t)*np.cos(p), np.cos(t)*np.sin(p), -np.sin(t)))
    ep_basis = np.stack((-np.sin(p), np.cos(p), np.zeros_like(p)))
    et, ep = np.sum(total*et_basis, axis=0), np.sum(total*ep_basis, axis=0)
    bare_power, total_power = np.sum(abs(direct)**2, axis=0), np.sum(abs(total)**2, axis=0)
    peak = float(np.max(bare_power))
    if peak <= 0:
        raise ValueError("EMerge source has zero amplitude on all observations.")
    db = lambda power: np.maximum(-300.0, 10*np.log10(np.maximum(power/peak, 1e-30)))
    bare_db, total_db = db(bare_power), db(total_power)
    cross = 2*np.real(np.sum(direct*np.conj(scattered), axis=0))/peak
    pattern = {"frequency_hz": frequency, "theta_deg": theta.tolist(), "phi_deg": phi.tolist(),
               "e_theta_v_m": _pairs(et), "e_phi_v_m": _pairs(ep)}
    cut_ids = np.arange(len(theta))*len(phi)
    radiation = {"frequencies_hz": [frequency], "patterns_3d": [pattern],
                 "cuts": [{"frequency_hz": frequency, "angles_deg": theta.tolist(), "phi_deg": 0,
                           "e_theta_v_m": _pairs(et[cut_ids]), "e_phi_v_m": _pairs(ep[cut_ids])}]}
    comparison = {"contract": "spike/optycal-pattern-comparison/v1", "frequency_hz": frequency,
                  "theta_deg": theta.tolist(), "phi_deg": phi.tolist(),
                  "bare_relative_db": bare_db.tolist(), "structure_relative_db": total_db.tolist(),
                  "delta_db": (total_db-bare_db).tolist(), "interference_cross_term": cross.tolist(),
                  "direct_e_xyz": _pairs(direct.T), "scattered_e_xyz": _pairs(scattered.T), "total_e_xyz": _pairs(total.T),
                  "field_units": "arbitrary coherent units; no EMerge absolute calibration assumed",
                  "normalization": "both cases share the bare field peak power reference",
                  "interference_normalization": "2 Re(E_direct dot conjugate(E_scattered)) / bare peak |E|^2",
                  "delta_null_floor_db": -300}
    return {"engine_version": version("optycal"), "radiation": radiation, "comparison": comparison,
            "illuminated_triangle_count": len(triangles)}
