# SPDX-License-Identifier: MIT
"""Bounded, source-aware projections of SPIKE results into FreeCAD reference overlays."""

from __future__ import annotations

import math
from .solver_link import freecad_xy

MAX_SAMPLES = 12000
_UNITS = {"voltage_v": "V", "voltage_drop_v": "V", "current_a": "A",
          "operating_point_impedance_ohm": "ohm", "current_density_a_mm2": "A/mm²",
          "power_loss_w": "W", "via_current_density_a_mm2": "A/mm²"}


def unwrap_result(response):
    if not isinstance(response, dict):
        raise ValueError("A SPIKE result object is required.")
    result = response.get("result", response)
    if not isinstance(result, dict):
        raise ValueError("SPIKE response has no result object.")
    if result.get("contract") == "spike/mesh-convergence/v1" and isinstance(result.get("result"), dict):
        result = result["result"]
    return result.get("analysis_result", result) if isinstance(result.get("analysis_result"), dict) else result


def available_fields(response):
    result = unwrap_result(response)
    if result.get("contract") == "spike/board-thermal-result/v1":
        return ["temperature_c"] if isinstance(result.get("grid"), dict) else []
    visual = (result.get("fields") or {}).get("visualization") or {}
    if visual.get("schema") != "spike/result-visualization/v1":
        return []
    return [name for name, rows in (visual.get("scalar_fields") or {}).items()
            if isinstance(rows, list) and rows]


def project_samples(response, field, *, design_id="", source_sha256=""):
    """Return exact solver samples; never interpolate a missing physical field."""
    result = unwrap_result(response)
    if result.get("status") != "completed":
        raise ValueError("Only completed results can be visualized.")
    provenance = result.get("provenance") or {}
    result_design = str(provenance.get("design_id") or "")
    result_source = str(provenance.get("board_source_sha256") or "")
    if result_design and design_id and result_design != design_id:
        raise ValueError("Result belongs to another KiCad design.")
    if result_source and source_sha256 and result_source != source_sha256:
        raise ValueError("Result belongs to another KiCad board revision.")
    if result.get("contract") == "spike/board-thermal-result/v1":
        if field != "temperature_c":
            raise ValueError("Board thermal result has only temperature_c for a spatial overlay.")
        grid = result.get("grid") or {}
        if grid.get("order") != "x-fast":
            raise ValueError("Unsupported board thermal grid order.")
        nx, ny = [int(x) for x in grid.get("shape", [])]
        x0, y0 = [float(x) for x in grid.get("origin_mm", [])]
        dx, dy = [float(x) for x in grid.get("spacing_mm", [])]
        values = grid.get("temperatures_c") or []
        if nx < 1 or ny < 1 or nx * ny > MAX_SAMPLES or len(values) != nx * ny:
            raise ValueError("Board thermal grid is absent, oversized, or inconsistent.")
        if not all(math.isfinite(v) for v in (x0, y0, dx, dy)) or dx <= 0 or dy <= 0:
            raise ValueError("Invalid board thermal coordinates.")
        # SPIKE grid origin is the board's minimum boundary. Each supplied
        # temperature belongs to one finite-volume cell, centered half a step
        # inside that boundary.
        samples = [{"x_mm": x0 + (ix + 0.5) * dx, "y_mm": y0 + (iy + 0.5) * dy,
                    "value": float(values[iy * nx + ix]), "kind": "grid",
                    "dx_mm": dx, "dy_mm": dy}
                   for iy in range(ny) for ix in range(nx)]
        unit = "°C"
    elif result.get("contract") == "spike/v1":
        visual = (result.get("fields") or {}).get("visualization") or {}
        if visual.get("schema") != "spike/result-visualization/v1":
            raise ValueError("This analysis did not provide a spatial visualization contract.")
        rows = (visual.get("scalar_fields") or {}).get(field)
        if not isinstance(rows, list) or not rows or len(rows) > MAX_SAMPLES:
            raise ValueError("The selected scalar field is missing or exceeds the overlay limit.")
        samples = [{"x_mm": float(row["x_mm"]), "y_mm": float(row["y_mm"]),
                    "value": float(row["value"]), "kind": "point",
                    "layer": str(row.get("layer", "")), "net": str(row.get("net", ""))}
                   for row in rows if isinstance(row, dict) and row.get("value") is not None]
        unit = _UNITS.get(field, "")
    else:
        raise ValueError("This solver result has no supported FreeCAD spatial overlay. Inspect its JSON report.")
    if not samples or not all(math.isfinite(row[key]) for row in samples for key in ("x_mm", "y_mm", "value")):
        raise ValueError("Result has no finite spatial samples.")
    return {"field": field, "unit": unit, "status": result["status"],
            "model_status": str(result.get("model_status", "")), "samples": samples,
            "minimum": min(row["value"] for row in samples),
            "maximum": max(row["value"] for row in samples)}


def probe_nearest(projection, x_mm, y_mm):
    x, y = float(x_mm), float(y_mm)
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError("Probe coordinates must be finite.")
    row = min(projection["samples"], key=lambda item: (item["x_mm"] - x) ** 2 + (item["y_mm"] - y) ** 2)
    return {**row, "distance_mm": math.hypot(row["x_mm"] - x, row["y_mm"] - y),
            "field": projection["field"], "unit": projection["unit"],
            "model_status": projection["model_status"]}


def overlay_height(document):
    """Place a top projection just above imported board/copper geometry."""
    tops = []
    for obj in document.Objects:
        if getattr(obj, "TypeId", "") != "Part::Feature":
            continue
        if str(getattr(obj, "SPIKEGeometryStatus", "")) not in {
                "detailed_step_board_approximate", "detailed_step_copper_approximate"}:
            continue
        shape = getattr(obj, "Shape", None)
        bounds = getattr(shape, "BoundBox", None)
        if bounds is not None and math.isfinite(float(bounds.ZMax)):
            tops.append(float(bounds.ZMax))
    return (max(tops) if tops else 0.0) + 0.08


def render_overlay(document, projection):
    """Render exact samples in bins, keeping display geometry separate from solver data."""
    import FreeCAD as App
    import Part

    old = [obj for obj in document.Objects if "SPIKEResultOverlay" in obj.PropertiesList]
    z = overlay_height(document)
    lo, hi = projection["minimum"], projection["maximum"]
    bins = [[] for _ in range(16)]
    for row in projection["samples"]:
        fraction = 0.5 if hi == lo else (row["value"] - lo) / (hi - lo)
        index = min(15, max(0, int(fraction * 15.999)))
        if row["kind"] == "grid":
            sx, sy = row["dx_mm"], row["dy_mm"]
            px, py = freecad_xy(row["x_mm"] - sx / 2, row["y_mm"] + sy / 2)
            shape = Part.makePlane(sx, sy, App.Vector(px, py, z))
        else:
            px, py = freecad_xy(row["x_mm"], row["y_mm"])
            shape = Part.Vertex(App.Vector(px, py, z + 0.01))
        bins[index].append(shape)
    document.openTransaction("Show SPIKE result overlay")
    try:
        for obj in old:
            document.removeObject(obj.Name)
        for index, shapes in enumerate(bins):
            if not shapes:
                continue
            obj = document.addObject("Part::Feature", "SPIKEResultBin")
            obj.Label = f"{projection['field']} · band {index + 1}/16"
            obj.Shape = Part.makeCompound(shapes)
            obj.addProperty("App::PropertyString", "SPIKEResultOverlay", "SPIKE Result")
            obj.SPIKEResultOverlay = projection["field"]
            obj.addProperty("App::PropertyString", "SPIKEModelStatus", "SPIKE Result")
            obj.SPIKEModelStatus = projection["model_status"]
            obj.addProperty("App::PropertyFloat", "SPIKEProjectionPlaneZmm", "SPIKE Result")
            obj.SPIKEProjectionPlaneZmm = z
            # Blue -> cyan -> yellow -> red; each shape holds exact solver samples.
            t = index / 15.0
            color = (min(1.0, 2 * t), min(1.0, 2 * (1 - abs(t - 0.5))), max(0.0, 1 - 2 * t))
            if obj.ViewObject is not None:
                obj.ViewObject.ShapeColor = color
                obj.ViewObject.PointColor = color
                obj.ViewObject.PointSize = 5.0
                obj.ViewObject.LineColor = color
                obj.ViewObject.Transparency = 20
        document.recompute()
        document.commitTransaction()
    except Exception:
        document.abortTransaction()
        raise


def clear_overlay(document):
    old = [obj for obj in document.Objects if "SPIKEResultOverlay" in obj.PropertiesList]
    if old:
        document.openTransaction("Clear stale SPIKE result overlay")
        try:
            for obj in old:
                document.removeObject(obj.Name)
            document.recompute()
            document.commitTransaction()
        except Exception:
            document.abortTransaction()
            raise
