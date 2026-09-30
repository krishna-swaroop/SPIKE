# SPDX-License-Identifier: Apache-2.0
"""Optional public EMCAD polygon API; no upstream implementation is bundled."""

from __future__ import annotations

import math

from extensions.emerge_suite.board_adapter import MAX_POLYGONS, MAX_VERTICES


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
