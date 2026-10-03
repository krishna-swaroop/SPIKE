# SPDX-License-Identifier: MIT
"""FreeCAD display of solver-owned mesh footprints and thermal cells."""

from __future__ import annotations

import math

from .solver_link import freecad_xy
from .result_view import overlay_height

MAX_THERMAL_CELLS = 8192
MAX_PREVIEW_CELLS = 5000


def thermal_grid(bounds, requested_step_mm):
    if bounds is None or len(bounds) != 4:
        raise ValueError("Linked board has no finite bounds for a thermal grid.")
    x0, y0, x1, y1 = [float(value) for value in bounds]
    step = float(requested_step_mm)
    if not all(math.isfinite(value) for value in (x0, y0, x1, y1, step)) or x1 <= x0 or y1 <= y0 or step <= 0:
        raise ValueError("Thermal grid needs finite board bounds and positive cell size.")
    nx, ny = math.ceil((x1 - x0) / step), math.ceil((y1 - y0) / step)
    if nx * ny > MAX_THERMAL_CELLS:
        raise ValueError(f"Thermal grid has {nx * ny} cells, above SPIKE's {MAX_THERMAL_CELLS}-cell limit.")
    return {"bounds": (x0, y0, x1, y1), "shape": (nx, ny),
            "spacing_mm": ((x1 - x0) / nx, (y1 - y0) / ny)}


def clear_mesh_preview(document):
    for obj in list(document.Objects):
        if "SPIKEMeshPreview" in obj.PropertiesList:
            document.removeObject(obj.Name)
    document.recompute()


def _feature(document, shape, label, details):
    old = [obj for obj in document.Objects if "SPIKEMeshPreview" in obj.PropertiesList]
    document.openTransaction("Show SPIKE mesh preview")
    try:
        for obj in old:
            document.removeObject(obj.Name)
        obj = document.addObject("Part::Feature", "SPIKEMeshPreview")
        obj.Label = label
        obj.Shape = shape
        obj.addProperty("App::PropertyString", "SPIKEMeshPreview", "SPIKE Mesh")
        obj.SPIKEMeshPreview = details
        if obj.ViewObject is not None:
            obj.ViewObject.LineColor = (1.0, 0.55, 0.10)
            obj.ViewObject.LineWidth = 1.0
        document.recompute()
        document.commitTransaction()
        return obj
    except Exception:
        document.abortTransaction()
        raise


def render_thermal_grid(document, grid):
    import FreeCAD as App
    import Part

    x0, y0, x1, y1 = grid["bounds"]
    nx, ny = grid["shape"]
    dx, dy = grid["spacing_mm"]
    z = overlay_height(document) + 0.02
    lines = []
    for ix in range(nx + 1):
        x = x0 + ix * dx
        a, b = freecad_xy(x, y0), freecad_xy(x, y1)
        lines.append(Part.makePolygon([App.Vector(*a, z), App.Vector(*b, z)]))
    for iy in range(ny + 1):
        y = y0 + iy * dy
        a, b = freecad_xy(x0, y), freecad_xy(x1, y)
        lines.append(Part.makePolygon([App.Vector(*a, z), App.Vector(*b, z)]))
    return _feature(document, Part.makeCompound(lines),
                    f"SPIKE thermal grid preview ({nx} × {ny}, {nx * ny} cells)",
                    f"thermal grid, {dx:.5g} × {dy:.5g} mm, preview only")


def render_pi_mesh(document, preview):
    import FreeCAD as App
    import Part

    if not isinstance(preview, dict) or preview.get("contract") != "spike/mesh/v3":
        raise ValueError("SPIKE did not return a versioned mesh preview.")
    cells = preview.get("cells")
    if not isinstance(cells, list) or not cells or len(cells) > MAX_PREVIEW_CELLS:
        raise ValueError(f"Mesh preview needs 1–{MAX_PREVIEW_CELLS} displayed cells.")
    shapes = []
    z = overlay_height(document) + 0.02
    for cell in cells:
        vertices = cell.get("vertices_mm") if isinstance(cell, dict) else None
        if not isinstance(vertices, list) or not 3 <= len(vertices) <= 64:
            raise ValueError("Mesh cell has unsupported vertices.")
        points = []
        for vertex in vertices:
            if not isinstance(vertex, (list, tuple)) or len(vertex) < 2:
                raise ValueError("Mesh vertex is invalid.")
            x, y = freecad_xy(vertex[0], vertex[1])
            points.append(App.Vector(x, y, z))
        shapes.append(Part.makePolygon(points + [points[0]]))
    quality = preview.get("quality") or {}
    details = (f"{len(cells)} sampled solver mesh cells; truncated={bool(preview.get('truncated'))}; "
               f"maximum aspect ratio={quality.get('maximum_aspect_ratio', 'unknown')}; "
               "outline projection only, no solved field")
    return _feature(document, Part.makeCompound(shapes),
                    f"SPIKE PI mesh preview ({len(cells)} cells)", details)
