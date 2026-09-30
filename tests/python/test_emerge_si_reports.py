# SPDX-License-Identifier: Apache-2.0
"""Reference checks for EMerge SI report binding and explicit eye assumptions."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from scripts.render_emerge_si_reports import admit_saved, dc_scenario, illustrative_eyes, mixed_mode
from python.spike_core.extension_analysis_results import design_binding


def ideal_network():
    f = np.arange(1, 65) * 1e8
    s = np.zeros((64, 4, 4), dtype=complex)
    s[:, 0, 1] = s[:, 1, 0] = s[:, 2, 3] = s[:, 3, 2] = 1
    return f, s


class EMergeSiReportTests(unittest.TestCase):
    def test_ideal_disjoint_lines_have_half_volt_eye_and_zero_interference(self):
        f, s = ideal_network()
        result = illustrative_eyes(f, s, 50.)
        self.assertEqual(result["status"], "completed")
        for scenario in result["scenarios"].values():
            rx = scenario["result"]["time_domain"]["receivers"][0]
            self.assertAlmostEqual(rx["eye_height_v"], .5, places=12)
            self.assertFalse(scenario["result"]["production_qualified"])
            self.assertIn("not an EMerge", scenario["result"]["external_scenario_assumptions"][0])
        self.assertAlmostEqual(result["peak_abs_interference_v_at_exported_samples"], 0., places=12)
        rx = result["differential"]["result"]["time_domain"]["receivers"][0]
        self.assertAlmostEqual(rx["eye_height_v"], .5, places=12)
        self.assertTrue(np.all(s == ideal_network()[1]))

    def test_mixed_mode_disjoint_ideal_through_oracle(self):
        _, s = ideal_network()
        modal = mixed_mode(s)
        np.testing.assert_allclose(modal, s, atol=1e-15)
        np.testing.assert_allclose(modal[:, 2:, :2], 0, atol=1e-15)

    def test_dc_completion_preserves_all_fem_samples(self):
        f, s = ideal_network()
        augmented_f, augmented_s = dc_scenario(f, s)
        np.testing.assert_array_equal(augmented_f[1:], f)
        np.testing.assert_array_equal(augmented_s[1:], s)
        np.testing.assert_array_equal(augmented_s[0], s[0])

    def test_nonuniform_or_insufficient_grid_blocks_eye(self):
        f, s = ideal_network()
        f[3] += 1e6
        self.assertEqual(illustrative_eyes(f, s, 50.)["status"], "blocked")
        f, s = ideal_network()
        self.assertEqual(illustrative_eyes(f[:20], s[:20], 50.)["status"], "blocked")
        self.assertEqual(illustrative_eyes(f, s, 75.)["status"], "blocked")

    def test_material_nonpassivity_blocks_eyes_without_repair(self):
        f, s = ideal_network()
        result = illustrative_eyes(f, s * 1.01, 50.)
        self.assertEqual(result["status"], "blocked")
        self.assertIn("passivity", result["reason"])

    def test_design_and_executed_script_must_match(self):
        with tempfile.TemporaryDirectory() as name:
            output = Path(name)
            design = {"contract": "spike/v1", "design_id": "fixture"}
            binding = design_binding(design)
            script = b"print('owned source')\n"
            raw = {"contract": "spike/v1", "analysis_id": "example", "status": "completed",
                   "mode": "si", "model_status": "unvalidated", "summary": {}, "fields": {},
                   "networks": {}, "probes": [], "issues": [],
                   "provenance": {"design_id": binding["design_id"], "design_digest_sha256": binding["digest_sha256"],
                                  "solver": "EMerge/test", "generated_script_sha256": hashlib.sha256(script).hexdigest()}}
            (output / "fixture_design.json").write_text(json.dumps(design), encoding="utf-8")
            (output / "fixture_result.json").write_text(json.dumps(raw), encoding="utf-8")
            (output / "fixture_simulation.py").write_bytes(script)
            self.assertTrue(admit_saved(output, "fixture")[1]["saved_script_matches_execution"])
            (output / "fixture_simulation.py").write_bytes(script + b"# changed\n")
            with self.assertRaisesRegex(ValueError, "digest"):
                admit_saved(output, "fixture")
            (output / "fixture_simulation.py").write_bytes(script)
            design["design_id"] = "changed"
            (output / "fixture_design.json").write_text(json.dumps(design), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "binding"):
                admit_saved(output, "fixture")


if __name__ == "__main__":
    unittest.main()
