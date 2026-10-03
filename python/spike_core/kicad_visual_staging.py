# SPDX-License-Identifier: Apache-2.0
"""Conservative graphical repairs in temporary KiCad visual export copies."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .model_resolver_staging import _existing_reference, _head, _sexpr_nodes


def stage_undefined_graphics(board: Path, output_dir: Path) -> tuple[Path, list[dict[str, Any]]]:
    """Move only recognized non-electrical undefined graphics to Dwgs.User.

    Never change the retained board, create a layer, or guess the meaning of
    undefined copper, pads, zones, footprint placement, or unknown objects.
    """
    source = board.read_bytes().decode("utf-8")
    if "UNDEFINED" not in source:
        return board, []
    parsed = _sexpr_nodes(source)
    roots = [node for node in parsed["children"] if _head(node) == "kicad_pcb"]
    if len(roots) != 1:
        raise ValueError("Visual repair requires exactly one KiCad board.")
    root = roots[0]
    edits: list[tuple[int, int, str]] = []
    kinds: dict[str, int] = {}
    board_graphics = {f"gr_{kind}" for kind in ("line", "arc", "circle", "rect", "poly", "text", "text_box", "curve")}
    footprint_graphics = {f"fp_{kind}" for kind in ("line", "arc", "circle", "rect", "poly", "text", "text_box", "curve")}

    def visit(node: dict[str, Any], ancestors: list[str]) -> None:
        kind = _head(node)
        if kind in board_graphics | footprint_graphics and any(_head(child) == "net" for child in node["children"]):
            if any(_head(child) == "layer" and any(atom["value"] == "UNDEFINED" for atom in child["atoms"][1:])
                   for child in node["children"]):
                raise ValueError("KiCad source has an UNDEFINED layer on a net-bearing graphic; resolve its layer in the PCB Editor.")
        if kind in {"layer", "layers"}:
            undefined = [atom for atom in node["atoms"][1:] if atom["value"] == "UNDEFINED"]
            if undefined:
                graphical = (len(ancestors) == 2 and ancestors[0] == "kicad_pcb" and ancestors[1] in board_graphics) or (
                    len(ancestors) == 3 and ancestors[0] == "kicad_pcb"
                    and ancestors[1] in {"footprint", "module"} and ancestors[2] in footprint_graphics)
                if not graphical or kind != "layer" or len(node["atoms"]) != 2:
                    raise ValueError(
                        "KiCad source has an UNDEFINED layer on an electrical or unsupported object "
                        f"({'/'.join(ancestors)}); resolve its layer in the PCB Editor before export."
                    )
                atom = undefined[0]
                edits.append((atom["start"], atom["end"], '"Dwgs.User"'))
                kinds[ancestors[-1]] = kinds.get(ancestors[-1], 0) + 1
        for child in node["children"]:
            visit(child, [*ancestors, kind])

    visit(root, [])
    if not edits:
        return board, []
    has_drawing_layer = any(
        len(row["atoms"]) >= 3 and row["atoms"][1]["value"] == "Dwgs.User" and row["atoms"][2]["value"] == "user"
        for table in root["children"] if _head(table) == "layers" for row in table["children"]
    )
    if not has_drawing_layer:
        raise ValueError("KiCad source has undefined graphics but no Dwgs.User layer; resolve the layers in the PCB Editor.")
    count = len(edits)
    # Moving the export copy must not break project-relative model references.
    def rebase_models(node: dict[str, Any]) -> None:
        if _head(node) == "model" and len(node["atoms"]) > 1:
            atom = node["atoms"][1]
            resolved = _existing_reference(str(atom["value"]), board.parent)
            if resolved is not None:
                edits.append((atom["start"], atom["end"], '"' + resolved.as_posix() + '"'))
        for child in node["children"]:
            rebase_models(child)
    rebase_models(root)
    for start, end, replacement in sorted(edits, reverse=True):
        source = source[:start] + replacement + source[end:]
    staged = output_dir / f".{board.stem}.spike-graphics.kicad_pcb"
    staged.write_bytes(source.encode("utf-8"))
    return staged, [{
        "code": "UNDEFINED_GRAPHICS_REASSIGNED", "visual_only": True,
        "source_layer": "UNDEFINED", "target_layer": "Dwgs.User",
        "object_count": count, "object_types": kinds,
        "message": f"Moved {count} undefined graphical annotations to Dwgs.User in the visual export copy; retained source unchanged.",
    }]
