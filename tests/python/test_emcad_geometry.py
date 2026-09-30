# SPDX-License-Identifier: Apache-2.0
"""Independent geometry invariants for the optional EMCAD adapter."""

import importlib.util
import types
import unittest

from extensions.emerge_suite.emcad_geometry import merge_copper


def rectangle(identity, x0, x1, net="RF", layer="F.Cu"):
    return {"id": identity, "net": net, "layer": layer,
            "xs_mm": [x0, x1, x1, x0], "ys_mm": [0, 0, 1, 1]}


class EMCADGeometryTests(unittest.TestCase):
    def test_net_layer_separation_and_hole_rejection(self):
        groups = []
        class Polygon:
            def __init__(self, xs, ys): self.xs, self.ys, self.holes = xs, ys, []
        def add(*polys):
            groups.append(polys)
            return list(polys)
        cad = types.SimpleNamespace(Polygon=Polygon, add_polygons=add)
        result = merge_copper([rectangle("a", 0, 1), rectangle("b", 2, 3),
                               rectangle("c", 0, 1, net="GND"),
                               rectangle("d", 0, 1, layer="In1.Cu")], cad)
        self.assertEqual([len(group) for group in groups], [2, 1, 1])
        self.assertEqual(len(result), 4)
        polygon = Polygon([0, 1, 1], [0, 0, 1])
        polygon.holes = [object()]
        cad.add_polygons = lambda *args: [polygon]
        with self.assertRaisesRegex(ValueError, "holes"):
            merge_copper([rectangle("a", 0, 1)], cad)
        cad.add_polygons = lambda *args: []
        with self.assertRaisesRegex(ValueError, "empty"):
            merge_copper([rectangle("a", 0, 1)], cad)

    @unittest.skipUnless(importlib.util.find_spec("emcad"), "Optional EMCAD runtime is not installed")
    def test_real_union_rectangle_area_bounds_and_disconnected_island(self):
        import emcad
        result = merge_copper([rectangle("a", 0, 2), rectangle("b", 1, 3),
                               rectangle("c", 5, 6)], emcad)
        self.assertEqual(len(result), 2)
        areas = []
        for row in result:
            xs, ys = row["xs_mm"], row["ys_mm"]
            areas.append(abs(sum(xs[i]*ys[(i+1) % len(xs)]-xs[(i+1) % len(xs)]*ys[i]
                                 for i in range(len(xs)))) / 2)
        self.assertEqual(sorted(areas), [1.0, 3.0])
        self.assertEqual(min(min(row["xs_mm"]) for row in result), 0)
        self.assertEqual(max(max(row["xs_mm"]) for row in result), 6)
