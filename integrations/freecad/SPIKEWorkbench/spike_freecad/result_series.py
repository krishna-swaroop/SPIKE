# SPDX-License-Identifier: MIT
"""Extract bounded, explicit 1D traces from non-spatial SPIKE results."""

from __future__ import annotations

import math

_AXES = ("time_s", "frequency_hz", "phase_ui")
_VALUES = ("voltage_v", "magnitude_db", "phase_deg", "current_a",
           "current_density_a_mm2", "temperature_c", "power_w")
MAX_SERIES = 32
MAX_POINTS = 2048


def _number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def _decimate(points):
    if len(points) <= MAX_POINTS:
        return points
    return [points[round(i * (len(points) - 1) / (MAX_POINTS - 1))] for i in range(MAX_POINTS)]


def extract_series(response):
    result = response.get("result", response) if isinstance(response, dict) else {}
    if isinstance(result, dict) and isinstance(result.get("analysis_result"), dict):
        result = result["analysis_result"]
    if not isinstance(result, dict):
        return []
    output = []
    visited = 0

    def add(name, x_label, y_label, points):
        if len(points) >= 2 and len(output) < MAX_SERIES:
            output.append({"name": name, "x_label": x_label, "y_label": y_label,
                           "points": _decimate(points)})

    def walk(value, path, depth):
        nonlocal visited
        if depth > 6 or visited > 20000 or len(output) >= MAX_SERIES:
            return
        visited += 1
        if isinstance(value, dict):
            for axis in _AXES:
                xs = value.get(axis)
                if not isinstance(xs, list) or len(xs) < 2:
                    continue
                for ordinate in _VALUES:
                    ys = value.get(ordinate)
                    if isinstance(ys, list) and len(ys) == len(xs):
                        points = [(x, y) for raw_x, raw_y in zip(xs, ys)
                                  if (x := _number(raw_x)) is not None
                                  and (y := _number(raw_y)) is not None]
                        add(f"{path}/{ordinate}", axis, ordinate, points)
                for key, series_map in value.items():
                    if isinstance(series_map, dict):
                        for name, ys in series_map.items():
                            if isinstance(ys, list) and len(ys) == len(xs):
                                points = [(x, y) for raw_x, raw_y in zip(xs, ys)
                                          if (x := _number(raw_x)) is not None
                                          and (y := _number(raw_y)) is not None]
                                add(f"{path}/{key}/{name}", axis, key, points)
            for key, child in value.items():
                if isinstance(child, (dict, list)):
                    walk(child, f"{path}/{key}", depth + 1)
        elif isinstance(value, list) and value and isinstance(value[0], dict):
            first = value[0]
            for axis in _AXES:
                if axis not in first:
                    continue
                for ordinate in _VALUES:
                    if ordinate not in first:
                        continue
                    points = [(x, y) for row in value if isinstance(row, dict)
                              if (x := _number(row.get(axis))) is not None
                              and (y := _number(row.get(ordinate))) is not None]
                    add(f"{path}/{ordinate}", axis, ordinate, points)
            for index, child in enumerate(value[:32]):
                walk(child, f"{path}/{index}", depth + 1)

    walk(result, "result", 0)
    return output
