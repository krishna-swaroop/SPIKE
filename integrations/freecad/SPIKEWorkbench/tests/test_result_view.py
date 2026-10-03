# SPDX-License-Identifier: MIT
import json
import sys
import unittest
from types import SimpleNamespace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from spike_freecad.result_view import available_fields, overlay_height, probe_nearest, project_samples


class ResultViewTests(unittest.TestCase):
    def test_overlay_uses_copper_top_not_group_or_components(self):
        def obj(type_id, status, top):
            return SimpleNamespace(TypeId=type_id, SPIKEGeometryStatus=status,
                                   Shape=SimpleNamespace(BoundBox=SimpleNamespace(ZMax=top)))
        document = SimpleNamespace(Objects=[
            obj("App::DocumentObjectGroup", "detailed_step_board_approximate", 14.095),
            obj("Part::Feature", "detailed_step_board_approximate", 1.51),
            obj("Part::Feature", "detailed_step_copper_approximate", 1.55),
            obj("Part::Feature", "detailed_step_components_approximate", 14.095),
        ])
        self.assertAlmostEqual(overlay_height(document), 1.63)

    def test_thermal_grid_and_probe(self):
        result = {"contract": "spike/board-thermal-result/v1", "status": "completed",
                  "model_status": "approximate", "provenance": {"design_id": "board-1",
                  "board_source_sha256": "abc"},
                  "grid": {"shape": [2, 2], "origin_mm": [10, 20],
                           "spacing_mm": [1, 2], "order": "x-fast",
                           "temperatures_c": [25, 26, 27, 28]}}
        self.assertEqual(available_fields(result), ["temperature_c"])
        projection = project_samples(result, "temperature_c", design_id="board-1", source_sha256="abc")
        self.assertEqual((projection["samples"][0]["x_mm"], projection["samples"][0]["y_mm"]), (10.5, 21.0))
        self.assertEqual(probe_nearest(projection, 11.1, 22.9)["value"], 28)
        with self.assertRaisesRegex(ValueError, "another KiCad board"):
            project_samples(result, "temperature_c", source_sha256="other")

    def test_dc_samples_and_absent_field(self):
        result = {"contract": "spike/v1", "status": "completed", "model_status": "approximate",
                  "fields": {"visualization": {"schema": "spike/result-visualization/v1",
                      "scalar_fields": {"voltage_v": [{"x_mm": 1, "y_mm": 2, "value": 3, "layer": "F.Cu"}]}}}}
        self.assertEqual(available_fields(result), ["voltage_v"])
        convergence = {"contract": "spike/mesh-convergence/v1", "status": "passed", "result": result}
        self.assertEqual(available_fields(convergence), ["voltage_v"])
        self.assertEqual(project_samples(result, "voltage_v")["samples"][0]["layer"], "F.Cu")
        with self.assertRaisesRegex(ValueError, "missing"):
            project_samples(result, "temperature_c")
        result["status"] = "blocked"
        with self.assertRaisesRegex(ValueError, "completed"):
            project_samples(result, "voltage_v")
