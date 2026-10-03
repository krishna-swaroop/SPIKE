# SPDX-License-Identifier: Apache-2.0
"""Explicit surface-PEC stackup, with top copper at zero millimetres."""

from __future__ import annotations

import math


def compile_stackup(stackup: object, number) -> tuple[list[dict], list[dict]]:
    if not isinstance(stackup, list):
        raise ValueError("Imported board needs a physical stackup.")
    relevant = [row for row in stackup if isinstance(row, dict) and
                (str(row.get("name", "")).endswith(".Cu") or
                 str(row.get("type", "")).lower() in {"core", "prepreg", "dielectric"})]
    copper, dielectrics = [], []
    depth = 0.0
    expect_copper = True
    for row in relevant:
        name = str(row.get("name", ""))
        is_copper = name.endswith(".Cu")
        if is_copper != expect_copper:
            raise ValueError("Stackup must alternate copper and explicit dielectric layers.")
        if is_copper:
            if any(layer["name"] == name for layer in copper):
                raise ValueError("Stackup copper layer names must be unique.")
            copper.append({"name": name, "z_mm": -depth})
        else:
            thickness = number(row.get("thickness", row.get("thickness_mm")),
                               "dielectric thickness", low=0.025, high=10)
            dielectrics.append({"name": name, "thickness_mm": thickness,
                                "epsilon_r": number(row.get("epsilon_r"), "relative permittivity", low=1, high=30),
                                "loss_tangent": number(row.get("loss_tangent", 0), "loss tangent", low=0, high=1),
                                "z_top_mm": -depth, "z_bottom_mm": -(depth + thickness)})
            depth += thickness
        expect_copper = not expect_copper
    if (expect_copper or not 2 <= len(copper) <= 16 or
            copper[0]["name"] != "F.Cu" or copper[-1]["name"] != "B.Cu"):
        raise ValueError("Stackup needs 2-16 copper layers from F.Cu to B.Cu.")
    if not math.isfinite(depth) or depth > 10:
        raise ValueError("Total dielectric thickness exceeds 10 mm.")
    return copper, dielectrics
