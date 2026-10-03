# SPDX-License-Identifier: Apache-2.0
"""Source crop and orientation checks for the public-board SI experiment."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

from scripts.run_emerge_board_si import build_section
from extensions.emerge_suite.board_adapter import compile_board


class BoardSectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        source = Path(self.directory.name) / "board.kicad_pcb"
        source.write_bytes(b"inert fixture")
        self.selection = {"source_path": str(source), "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                          "tracks": [{"id": "a", "net_name": "A", "start": [10, 10], "end": [20, 10], "width": .1},
                                     {"id": "b", "net_name": "B", "start": [20, 10.4], "end": [10, 10.4], "width": .1}],
                          "overlap": [[[11, 10], [19, 10]], [[11, 10.4], [19, 10.4]]],
                          "dielectric": {"thickness_mm": .1, "epsilon_r": 4.5, "loss_tangent": .02}}

    def test_rotated_source_section_and_port_identity(self):
        design, parameters, assumptions = build_section("fixture", self.selection)
        self.assertEqual(design["tracks"][0]["start"], [0, 0])
        self.assertEqual(design["tracks"][0]["end"], [0, 8])
        self.assertAlmostEqual(abs(design["tracks"][1]["start"][0]), .4)
        self.assertAlmostEqual(assumptions["edge_gap_mm"], .3)
        case = compile_board(design, parameters)
        self.assertEqual([p["signal_net"] for p in case["port_mapping"]], ["A", "A", "B", "B"])
        self.assertFalse(parameters["preview_radiation"])

    def test_source_changes_and_non_source_endpoints_rejected(self):
        selection = copy.deepcopy(self.selection)
        selection["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "Source fixture changed"):
            build_section("fixture", selection)
        for point in ([9, 10], [11, 10.01]):
            selection = copy.deepcopy(self.selection)
            selection["overlap"][0][0] = point
            with self.assertRaises(ValueError):
                build_section("fixture", selection)

    def test_overlapping_conductors_rejected(self):
        selection = copy.deepcopy(self.selection)
        selection["tracks"][1]["width"] = .8
        with self.assertRaisesRegex(ValueError, "disjoint"):
            build_section("fixture", selection)


if __name__ == "__main__":
    unittest.main()
