# SPDX-License-Identifier: MIT
"""Worker and KiCad link boundaries without a FreeCAD installation."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from spike_freecad.solver_link import board_bounds, component_records, freecad_xy, request_line, source_digest, validate_runtime  # noqa: E402


class SolverLinkTests(unittest.TestCase):
    def test_component_metadata_and_reference_bounds(self):
        design = {
            "contract": "spike/v1", "source_format": "kicad",
            "metadata": {"board_bounds_mm": [1, 2, 11, 22]},
            "components": [{"reference": "U1", "at": [3, 4], "value": "MCU",
                            "properties": {"MPN": "ABC-123"}, "nets": ["VCC"]}],
        }
        self.assertEqual(board_bounds(design), (1, 2, 11, 22))
        self.assertEqual(component_records(design)[0]["properties"]["MPN"], "ABC-123")
        design["components"].append({"reference": "U1", "at": [5, 6]})
        with self.assertRaises(ValueError):
            component_records(design)

    def test_worker_request_is_finite_and_bounded(self):
        value = json.loads(request_line("run_board_thermal", {"request": {}}, 7))
        self.assertEqual(value["id"], 7)
        with self.assertRaises(ValueError):
            request_line("run;code", {}, 1)
        with self.assertRaises(ValueError):
            request_line("run_analysis", {"x": float("nan")}, 1)

    def test_runtime_and_source_digest(self):
        repository = Path(__file__).resolve().parents[4]
        self.assertEqual(validate_runtime(str(repository), "python")[0], str(repository))
        with tempfile.TemporaryDirectory() as temporary:
            board = Path(temporary) / "test.kicad_pcb"
            board.write_bytes(b"board")
            first = source_digest(str(board))
            board.write_bytes(b"changed")
            self.assertNotEqual(first, source_digest(str(board)))

    def test_freecad_coordinates_match_kicad_step_frame(self):
        self.assertEqual(freecad_xy(74.7, 44.05), (74.7, -44.05))
        with self.assertRaises(ValueError):
            freecad_xy(1, float("nan"))
