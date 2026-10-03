# SPDX-License-Identifier: Apache-2.0
"""Bounded ODB++ source inspection for import step selection."""
from __future__ import annotations

from pathlib import Path

from .importers import ImportPolicy
from .odb_importer import matrix_blocks as parse_matrix
from .source_package import SourcePackage, safe_member_name


ODB_SOURCE_INSPECTION_CONTRACT = "spike/odb-source-inspection/v1"


def inspect_odb_source(
    path: str | Path,
    *,
    policy: ImportPolicy | None = None,
) -> dict[str, object]:
    """Read only the ODB++ matrix and return the available import steps.

    ``SourcePackage`` applies the same archive, path, size, and timeout policy as
    full import. Geometry and other step members are deliberately not read.
    """
    with SourcePackage(path, policy) as package:
        root = package.root_for("matrix/matrix")
        blocks = parse_matrix(package.text(root + "matrix/matrix", required=True))

    step_blocks = [block for block in blocks if block.get("block") == "STEP"]
    if not step_blocks:
        raise ValueError("ODB++ matrix does not declare any steps.")

    steps: list[str] = []
    seen_steps: set[str] = set()
    for block in step_blocks:
        name = block.get("NAME", "").strip()
        if not name:
            raise ValueError("ODB++ STEP block is missing a NAME.")
        # Full import lowercases matrix identities before step selection. Return
        # that same usable identity so inspection and import cannot disagree.
        normalized = name.lower()
        if normalized in seen_steps:
            raise ValueError(f"Duplicate ODB++ step name: {name}")
        seen_steps.add(normalized)
        if "/" in safe_member_name(normalized):
            raise ValueError(f"Unsafe ODB++ step name: {name}")
        steps.append(normalized)

    result: dict[str, object] = {
        "contract": ODB_SOURCE_INSPECTION_CONTRACT,
        "steps": steps,
        "layer_count": sum(block.get("block") == "LAYER" for block in blocks),
    }
    if len(steps) == 1:
        result["default_step"] = steps[0]
    return result
