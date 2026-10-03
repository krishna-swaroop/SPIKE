# SPDX-License-Identifier: MIT
"""Mesh preview limits match the board solver's admitted grid."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spike_freecad.mesh_view import thermal_grid  # noqa: E402


class MeshViewTests(unittest.TestCase):
    def test_thermal_grid_uses_board_bounds_and_cell_limit(self):
        grid = thermal_grid((0, 0, 10, 5), 2)
        self.assertEqual(grid["shape"], (5, 3))
        self.assertEqual(grid["spacing_mm"], (2.0, 5 / 3))
        with self.assertRaisesRegex(ValueError, "limit"):
            thermal_grid((0, 0, 100, 100), 1)
        with self.assertRaises(ValueError):
            thermal_grid((0, 0, 10, 5), float("nan"))


if __name__ == "__main__":
    unittest.main()
