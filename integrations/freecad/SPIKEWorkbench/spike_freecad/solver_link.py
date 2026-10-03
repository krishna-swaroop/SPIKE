# SPDX-License-Identifier: MIT
"""Pure data boundary for a linked KiCad design and SPIKE worker requests."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any


MAX_REQUEST_BYTES = 32 * 1024 * 1024


def freecad_xy(x_mm: float, y_mm: float) -> tuple[float, float]:
    """Map KiCad PCB coordinates to KiCad's STEP/FreeCAD X, negative-Y frame."""
    x, y = float(x_mm), float(y_mm)
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError("Board coordinates must be finite.")
    return x, -y


def source_digest(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def component_records(design: dict[str, Any]) -> list[dict[str, Any]]:
    if design.get("contract") != "spike/v1" or design.get("source_format") != "kicad":
        raise ValueError("A normalized KiCad DesignIR is required.")
    records = []
    seen = set()
    for item in design.get("components", []):
        reference = str(item.get("reference", "")).strip()
        if not reference or reference in seen:
            raise ValueError("KiCad component references must be unique and non-empty.")
        seen.add(reference)
        at = item.get("at")
        if not isinstance(at, (list, tuple)) or len(at) < 2:
            continue
        x, y = float(at[0]), float(at[1])
        if not all(math.isfinite(value) for value in (x, y)):
            raise ValueError("Component coordinates must be finite.")
        records.append({
            "reference": reference, "x_mm": x, "y_mm": y,
            "source_id": str(item.get("source_id") or item.get("id") or reference),
            "library": str(item.get("library", "")),
            "value": str(item.get("value", "")),
            "properties": dict(item.get("properties") or {}),
            "model_path": str(item.get("model_path", "")),
            "model_resolved": str(item.get("model_resolved", "")),
            "layer": str(item.get("layer", "")),
            "rotation": float(item.get("rotation", 0)),
            "nets": list(item.get("nets") or []),
            "pad_count": int(item.get("pad_count", 0)),
        })
    return records


def board_bounds(design: dict[str, Any]) -> tuple[float, float, float, float] | None:
    value = (design.get("metadata") or {}).get("board_bounds_mm")
    if not isinstance(value, list) or len(value) != 4:
        return None
    bounds = tuple(float(x) for x in value)
    if not all(math.isfinite(x) for x in bounds):
        return None
    return bounds if bounds[2] > bounds[0] and bounds[3] > bounds[1] else None


def request_line(method: str, params: dict[str, Any], request_id: int) -> bytes:
    if not isinstance(method, str) or not method or any(c not in "abcdefghijklmnopqrstuvwxyz_0123456789" for c in method):
        raise ValueError("Invalid SPIKE worker method name.")
    if not isinstance(params, dict):
        raise ValueError("Worker params must be a JSON object.")
    payload = json.dumps({"id": request_id, "method": method, "params": params}, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_REQUEST_BYTES:
        raise ValueError("Worker request exceeds 32 MiB.")
    return payload + b"\n"


def validate_runtime(repository: str, executable: str) -> tuple[str, str]:
    root = Path(repository).expanduser().resolve()
    if not (root / "python" / "spike_core" / "service.py").is_file():
        raise ValueError("Select a SPIKE source directory containing python/spike_core/service.py.")
    if not executable.strip():
        raise ValueError("Select a Python executable for the SPIKE worker.")
    return str(root), executable.strip()
