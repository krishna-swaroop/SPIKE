# SPDX-License-Identifier: Apache-2.0
"""Independent source/phase/topology and extension provenance regression checks."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
from pathlib import Path
import unittest

import numpy as np

from extensions.optycal_suite.extension import execute, _validate_comparison
from extensions.optycal_suite.source import PHASE_ASSUMPTION, prepare_source
from extensions.optycal_suite.study import prepare_case, generate_script
from extensions.optycal_suite.runner import source_functions, rotation_matrix, illuminated_triangles
from python.spike_core.extensions import ExtensionManifest

ROOT = Path(__file__).resolve().parents[2]
BINDING = {"design_id": "test-board", "digest_sha256": "a"*64}


def source():
    theta, phi = [0, 90, 180], [0, 90, 180, 270, 360]
    et, ep = [], []
    for t in theta:
        for p in phi:
            et.append([math.cos(math.radians(t))*math.cos(math.radians(p)), 0])
            ep.append([-math.sin(math.radians(p)), 0])
    return {"contract": "spike/v1", "analysis_id": "emerge-test", "status": "completed", "mode": "emi", "model_status": "unvalidated",
            "fields": {"radiation": {"frequencies_hz": [3e9], "excitation_port": "P1", "excitation_ports": ["P1"], "excitation_coefficients": [[1, 0]], "cuts": [{"frequency_hz": 3e9, "angles_deg": theta, "e_theta_v_m": [[1, 0]]*3, "e_phi_v_m": [[0, 0]]*3}],
                "patterns_3d": [{"frequency_hz": 3e9, "theta_deg": theta, "phi_deg": phi, "e_theta_v_m": et, "e_phi_v_m": ep}]}},
            "provenance": {"solver": "EMerge/3.0.0a19", "extension_id": "spike.emerge-suite", "board_case_sha256": "d"*64, "generated_script_sha256": "e"*64, "design_id": BINDING["design_id"], "design_digest_sha256": BINDING["digest_sha256"]}}


def parameters():
    return {"emerge_analysis_result": source(), "frequency_hz": 3e9, "source_phase_assumption": PHASE_ASSUMPTION,
            "antenna_aperture_mm": 100, "step_path": "fixture.step", "theta_step_deg": 30, "phi_step_deg": 30,
            "observation_radius_m": 100}


def mesher(_path, **kwargs):
    return {"contract": "spike/optycal-structure-mesh/v1", "vertices_mm": [[0, 0, 1000], [100, 0, 1000], [0, 100, 1000], [0, 0, 1100]],
            "triangles": [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]], "source_sha256": "b"*64}


class OptycalTests(unittest.TestCase):
    def test_manifest_is_a_separate_bounded_extension(self):
        manifest = ExtensionManifest.from_dict(json.loads((ROOT/"extensions/optycal_suite/spike-extension.json").read_text()))
        self.assertEqual(manifest.id, "spike.optycal-suite")

    def test_source_binding_phase_and_exact_frequency_are_required(self):
        values = parameters()
        case = prepare_source(values, BINDING)
        self.assertEqual(case["frequency_hz"], 3e9)
        self.assertEqual(len(case["source_sha256"]), 64)
        for key, value in (("frequency_hz", 3.01e9), ("source_phase_assumption", "")):
            bad = {**values, key: value}
            with self.assertRaises(ValueError):
                prepare_source(bad, BINDING)
        with self.assertRaisesRegex(ValueError, "different board"):
            prepare_source(values, {**BINDING, "digest_sha256": "c"*64})
        bad = copy.deepcopy(values)
        bad["emerge_analysis_result"]["fields"]["radiation"]["patterns_3d"][0]["e_theta_v_m"][0] = [math.nan, 0]
        with self.assertRaises(ValueError):
            prepare_source(bad, BINDING)

    def test_source_callback_phase_and_impedance_oracle(self):
        nf, ff = source_functions(prepare_source(parameters(), BINDING)["source_pattern"])
        k = 20.
        t, p = np.array([math.pi/2]), np.array([math.pi/2])
        field = np.asarray(ff(t, p, k))
        np.testing.assert_allclose(field[:3, 0], [1, 0, 0], atol=1e-14)
        np.testing.assert_allclose(field[3:, 0], [0, 0, -1/376.730313668], atol=1e-14)
        radius = np.array([2.])
        sampled = np.asarray(nf(t, p, radius, k))
        np.testing.assert_allclose(sampled, field, atol=1e-14)
        np.testing.assert_allclose(rotation_matrix([0, 0, 90]) @ [1, 0, 0], [0, 1, 0], atol=1e-14)

    def test_geometry_limits_and_farzone_failure(self):
        values = parameters()
        case = prepare_case(values, BINDING, mesher=mesher)
        self.assertGreater(case["minimum_separation_bound_m"], case["required_separation_m"])
        for key, value in (("observation_radius_m", 1), ("antenna_aperture_mm", 1000), ("theta_step_deg", True), ("structure_material", "plastic")):
            with self.assertRaises(ValueError):
                prepare_case({**values, key: value}, BINDING, mesher=mesher)
        mesh = mesher("fixture")
        triangles = np.array(mesh["triangles"])
        retained = illuminated_triangles(np.array(mesh["vertices_mm"])*.001, triangles, np.zeros(3))
        np.testing.assert_equal(retained, [[0, 2, 1]])

    def test_readable_script_hash_and_changed_step_binding(self):
        request = {"contract": "spike/extension/v1", "request_id": "preview", "contribution_id": "optycal-preview", "context": {"parameters": parameters(), "design_binding": BINDING}}
        preview = execute(request, mesher=mesher, backend=lambda *_a, **_k: self.fail("Preview must not solve"))["data"]
        self.assertFalse(preview["solved"])
        self.assertEqual(hashlib.sha256(preview["script"].encode()).hexdigest(), preview["script_sha256"])
        self.assertIn("surface.expose_xyz", preview["script"])
        self.assertNotIn("from extensions.", preview["script"])
        scope = {"__name__": "preview_test"}
        exec(preview["script"], scope)
        self.assertEqual(scope["CASE"]["source_phase_assumption"], PHASE_ASSUMPTION)
        request["contribution_id"] = "optycal-radiation"
        request["context"]["parameters"]["expected_generated_script_sha256"] = preview["script_sha256"]
        request["context"]["parameters"]["antenna_rotation_deg"] = [0, 0, 90]
        with self.assertRaisesRegex(ValueError, "changed"):
            execute(request, mesher=mesher, backend=lambda *_a, **_k: self.fail("Changed preview must not solve"))

    def test_comparison_rejects_incoherent_total(self):
        case = prepare_case(parameters(), BINDING, mesher=mesher)
        theta, phi = list(range(0, 181, 30)), list(range(0, 361, 30))
        size = len(theta)*len(phi)
        value = {"contract": "spike/optycal-pattern-comparison/v1", "frequency_hz": 3e9, "theta_deg": theta, "phi_deg": phi,
                 **{key: [0.]*size for key in ("bare_relative_db", "structure_relative_db", "delta_db", "interference_cross_term")},
                 **{key: [[[1., 0.], [0., 0.], [0., 0.]] for _ in range(size)] for key in ("direct_e_xyz", "total_e_xyz")},
                 "scattered_e_xyz": [[[0., 0.]]*3 for _ in range(size)]}
        _validate_comparison(value, case)
        bad = copy.deepcopy(value)
        bad["interference_cross_term"][0] = 1
        with self.assertRaisesRegex(ValueError, "complex field"):
            _validate_comparison(bad, case)
        value["total_e_xyz"][0][0] = [2, 0]
        with self.assertRaisesRegex(ValueError, "coherent"):
            _validate_comparison(value, case)

    @unittest.skipUnless(os.environ.get("SPIKE_OPTYCAL_INTEGRATION") == "1", "Optional separately installed Optycal phase oracle")
    def test_actual_surface_outgoing_phase_oracle(self):
        import optycal as op
        # Independently specified flat PEC rectangle, not an upstream fixture.
        k0 = 2*math.pi*1e9/299792458
        ff = lambda t, p, k: (np.ones_like(t), np.zeros_like(t), np.zeros_like(t), np.zeros_like(t), np.ones_like(t)/376.730313668, np.zeros_like(t))
        nf = lambda t, p, r, k: ff(t, p, k)
        antenna = op.Antenna(0, 0, 0, 1e9, nf_pattern=nf, ff_pattern=ff)
        point_radii = np.array([1., 2.])
        direct = antenna.expose_xyz(np.zeros(2), np.zeros(2), point_radii).E
        np.testing.assert_allclose(direct[0], np.exp(-1j*k0*point_radii)/point_radii, rtol=1e-12, atol=1e-12)
        mesh = op.Mesh(np.array([[-.1, .1, .1, -.1], [-.1, -.1, .1, .1], [1., 1., 1., 1.]]))
        mesh.set_triangles(np.array([[0, 1, 2], [0, 2, 3]]))
        surface = op.Surface(mesh, op.FRES_PEC, polyorder=1)
        antenna.expose_surface(surface)
        radii = np.array([100., 100.+math.pi/(2*k0)])
        scattered = surface.expose_xyz(np.zeros(2), np.zeros(2), radii).E
        component = np.argmax(abs(scattered[:, 0]))
        ratio = scattered[component, 1]/scattered[component, 0]
        self.assertLess(abs(ratio + 1j*radii[0]/radii[1]), .003)

    @unittest.skipUnless(os.environ.get("SPIKE_OPTYCAL_INTEGRATION") == "1", "Optional separately installed Optycal amplitude oracle")
    def test_actual_pec_specular_amplitude_oracle(self):
        import optycal as op
        # PEC reflection doubles the equivalent electric surface current.
        # At normal incidence in the far zone this gives |E_s|=A|E_i|/(lambda R).
        # Unit source coefficient at distance D supplies |E_i|=1/D. Dimensions
        # are SI; phase-curvature corrections here are below the 0.5% tolerance.
        n = 11
        coordinates = np.linspace(-.1, .1, n)
        vertices = np.array([[x, y, 0.] for y in coordinates for x in coordinates])
        triangles = []
        for y in range(n-1):
            for x in range(n-1):
                i = y*n+x
                triangles.extend([[i, i+n+1, i+1], [i, i+n, i+n+1]])
        mesh = op.Mesh(vertices)
        mesh.set_triangles(np.array(triangles))
        surface = op.Surface(mesh, op.FRES_PEC, polyorder=1)
        ff = lambda t, p, k: (np.ones_like(t), np.zeros_like(t), np.zeros_like(t), np.zeros_like(t), np.ones_like(t)/376.730313668, np.zeros_like(t))
        nf = lambda t, p, r, k: ff(t, p, k)
        antenna = op.Antenna(0, 0, -100, 1e9, nf_pattern=nf, ff_pattern=ff)
        antenna.expose_surface(surface)
        reflected = surface.expose_xyz(np.array([0.]), np.array([0.]), np.array([-100.])).E
        actual = float(np.linalg.norm(reflected))
        expected = .04/(299792458/1e9*100*100)
        self.assertLess(abs(actual/expected-1), .005)


if __name__ == "__main__":
    unittest.main()
