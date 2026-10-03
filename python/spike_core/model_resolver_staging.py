# SPDX-License-Identifier: Apache-2.0
"""KiCad source adapter for visual-only component model resolution."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable

from python.core.board_parser import KicadParser
from .model_library import resolve_model

MAX_MODEL_BYTES = 64 * 1024 * 1024


def _sexpr_nodes(source: str) -> Dict[str, Any]:
    parser = KicadParser.__new__(KicadParser)
    parser.parse_sexp(parser.tokenize(source))
    root: Dict[str, Any] = {"children": [], "atoms": [], "start": 0, "end": len(source)}
    stack = [root]
    index = 0
    while index < len(source):
        character = source[index]
        if character.isspace():
            index += 1
        elif character == "(":
            node: Dict[str, Any] = {"children": [], "atoms": [], "start": index, "end": None}
            stack[-1]["children"].append(node)
            stack.append(node)
            index += 1
        elif character == ")":
            stack[-1]["end"] = index + 1
            stack.pop()
            index += 1
        else:
            start = index
            if character == '"':
                index += 1
                escaped = False
                while index < len(source):
                    current = source[index]
                    if escaped:
                        escaped = False
                    elif current == "\\":
                        escaped = True
                    elif current == '"':
                        index += 1
                        break
                    index += 1
            else:
                while index < len(source) and not source[index].isspace() and source[index] not in "()":
                    index += 1
            raw = source[start:index]
            value = raw[1:-1] if raw.startswith('"') and raw.endswith('"') else raw
            stack[-1]["atoms"].append({"value": value, "start": start, "end": index, "quoted": raw.startswith('"')})
    return root


def _head(node: Dict[str, Any]) -> str:
    atoms = node.get("atoms", [])
    return str(atoms[0]["value"]) if atoms else ""


def _component_reference(node: Dict[str, Any]) -> str:
    for child in node.get("children", []):
        atoms = child.get("atoms", [])
        if _head(child) == "property" and len(atoms) > 2 and atoms[1]["value"] == "Reference":
            return str(atoms[2]["value"])
        if _head(child) == "fp_text" and len(atoms) > 2 and atoms[1]["value"] == "reference":
            return str(atoms[2]["value"])
    return ""


def _validated_override(path_value: str) -> Path:
    if not isinstance(path_value, str) or not path_value.strip() or "\x00" in path_value:
        raise ValueError("Choose a readable STEP or VRML replacement model.")
    replacement = Path(path_value).expanduser().resolve()
    if replacement.suffix.lower() not in {".step", ".stp", ".wrl", ".vrml"} or not replacement.is_file():
        raise ValueError("Choose a readable STEP or VRML replacement model.")
    if replacement.stat().st_size > MAX_MODEL_BYTES:
        raise ValueError(f"Replacement model exceeds the {MAX_MODEL_BYTES} byte visual-export limit.")
    return replacement


def _existing_reference(reference: str, board_parent: Path) -> Path | None:
    normalized = reference.replace("\\", "/")
    if normalized.startswith("${KIPRJMOD}/"):
        candidate = board_parent / normalized.removeprefix("${KIPRJMOD}/")
    else:
        if reference.startswith("${"):
            return None
        expanded = os.path.expandvars(reference)
        if "$" in expanded:
            return None
        path = Path(expanded).expanduser()
        candidate = path if path.is_absolute() else board_parent / path
    try:
        return candidate.resolve() if candidate.is_file() else None
    except OSError:
        return None


def _configured_reference(reference: str) -> Path | None:
    normalized = reference.replace("\\", "/")
    match = re.match(r"^\$\{(KICAD\d+_3DMODEL_DIR|KICAD3DMOD|KICAD\d+_3RD_PARTY)\}/(.+)$", normalized, re.I)
    if not match:
        return None
    configured = os.environ.get(match.group(1))
    if not configured:
        return None
    candidate = Path(configured) / match.group(2)
    alternatives = [candidate]
    if candidate.suffix.lower() in {".wrl", ".vrml"}:
        alternatives = [candidate.with_suffix(".step"), candidate.with_suffix(".stp"), candidate]
    try:
        return next((item.resolve() for item in alternatives if item.is_file()), None)
    except OSError:
        return None


def automatic_component_model_overrides(source: str, additional_roots: Iterable[str | Path] = ()) -> Dict[str, str]:
    parsed = _sexpr_nodes(source)
    boards = [node for node in parsed["children"] if _head(node) == "kicad_pcb"]
    if not boards:
        raise ValueError("Invalid or unrecognized KiCad PCB file format")
    assignments: Dict[str, str] = {}
    resolved_footprints: Dict[str, Dict[str, Any]] = {}
    for node in boards[0].get("children", []):
        if _head(node) not in {"footprint", "module"} or any(_head(child) == "model" for child in node.get("children", [])):
            continue
        atoms = node.get("atoms", [])
        footprint = str(atoms[1]["value"]) if len(atoms) > 1 else ""
        reference = _component_reference(node)
        if not reference or reference in assignments:
            continue
        if footprint not in resolved_footprints:
            resolved_footprints[footprint] = resolve_model(
                reference="", footprint=footprint, additional_roots=additional_roots,
            )
        result = resolved_footprints[footprint]
        if result.get("automatic_path"):
            assignments[reference] = str(result["automatic_path"])
    return assignments


def stage(
    board: Path,
    output_dir: Path,
    model_overrides: Dict[str, str] | None = None,
    resolution: Dict[str, Any] | None = None,
    component_model_overrides: Dict[str, str] | None = None,
) -> tuple[Path, list[Dict[str, str]]]:
    from .models import model_library_roots

    output_dir.mkdir(parents=True, exist_ok=True)
    source = board.read_text(encoding="utf-8", errors="replace")
    roots = model_library_roots((board.parent,))
    substitutions: list[Dict[str, str]] = []
    unresolved: list[str] = []
    edits: list[tuple[int, int, str]] = []
    retained_paths: list[tuple[Dict[str, Any], Path, str, str]] = []
    resolver_cache: Dict[tuple[str, str], Dict[str, Any]] = {}
    parsed = _sexpr_nodes(source)
    boards = [node for node in parsed["children"] if _head(node) == "kicad_pcb"]
    if not boards:
        raise ValueError("Invalid or unrecognized KiCad PCB file format")

    def resolve(reference: str, footprint: str) -> Dict[str, Any]:
        key = (reference, footprint)
        if key not in resolver_cache:
            resolver_cache[key] = resolve_model(
                reference=reference, footprint=footprint, additional_roots=(board.parent, *roots),
            )
        return resolver_cache[key]

    def stage_model(node: Dict[str, Any], footprint: str, component: str, component_override: str = "") -> None:
        atoms = node.get("atoms", [])
        if len(atoms) < 2:
            return
        path_atom = atoms[1]
        reference = str(path_atom["value"])
        resolver_status = library_root = match_reason = ""
        if component_override:
            resolved: Path | None = _validated_override(component_override)
            origin = "component_override"
        elif reference in (model_overrides or {}):
            resolved = _validated_override((model_overrides or {})[reference])
            origin = "reference_override"
        else:
            if reference.casefold().startswith("kicad-embed://"):
                return
            existing = _existing_reference(reference, board.parent)
            if existing is not None:
                retained_paths.append((path_atom, existing, footprint, component))
                return
            resolved = _configured_reference(reference)
            if resolved is not None:
                result = {}
                origin = "configured_path"
            else:
                try:
                    result = resolve(reference, footprint)
                except OSError:
                    result = {"status": "index_unavailable", "automatic_path": None, "candidates": []}
            automatic = result.get("automatic_path")
            if resolved is None:
                resolved = Path(str(automatic)).resolve() if automatic else None
                origin = "local_fallback"
            resolver_status = str(result.get("status") or "")
            selected = next((item for item in result.get("candidates", []) if str(item.get("path", "")) == str(automatic)), {})
            library_root = str(selected.get("root") or "")
            match_reason = str(selected.get("reason") or "")
        if resolved is None:
            unresolved.append(reference)
            return
        resolved_text = resolved.as_posix()
        if resolved_text == reference:
            return
        quote = '"' if path_atom.get("quoted") else ""
        edits.append((path_atom["start"], path_atom["end"], f"{quote}{resolved_text}{quote}"))
        substitutions.append({"source": reference, "resolved": resolved_text, "origin": origin,
            "component_reference": component, "footprint": footprint, "visual_only": "true",
            "resolver_status": resolver_status, "library_root": library_root, "match_reason": match_reason})

    root = boards[0]
    for footprint_node in root.get("children", []):
        if _head(footprint_node) not in {"footprint", "module"}:
            continue
        atoms = footprint_node.get("atoms", [])
        footprint = str(atoms[1]["value"]) if len(atoms) > 1 else ""
        component = _component_reference(footprint_node)
        models = [child for child in footprint_node.get("children", []) if _head(child) == "model"]
        component_override = (component_model_overrides or {}).get(component, "")
        for model in models:
            stage_model(model, footprint, component, component_override)
        if not models:
            result: Dict[str, Any] = {}
            if component_override:
                resolved = _validated_override(component_override)
                origin = "component_override"
            else:
                result = resolve("", footprint)
                automatic = result.get("automatic_path")
                resolved = Path(str(automatic)).resolve() if automatic else None
                origin = "local_fallback"
            if resolved is not None:
                resolved_text = resolved.as_posix()
                insertion = f'\n    (model "{resolved_text}" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))'
                end = int(footprint_node["end"]) - 1
                edits.append((end, end, insertion))
                substitutions.append({"source": "", "resolved": resolved_text, "origin": origin,
                    "component_reference": component, "footprint": footprint, "visual_only": "true",
                    "resolver_status": str(result.get("status") or "")})

    for model in root.get("children", []):
        if _head(model) == "model":
            stage_model(model, "", "")
    if substitutions:
        # A new export directory changes KIPRJMOD and relative-path context.
        # Keep the exact existing asset when another assignment requires a copy.
        for atom, existing, footprint, component in retained_paths:
            reference, resolved_text = str(atom["value"]), existing.as_posix()
            if reference == resolved_text:
                continue
            edits.append((atom["start"], atom["end"], f'"{resolved_text}"'))
            substitutions.append({"source": reference, "resolved": resolved_text,
                "origin": "preserved_project_path", "component_reference": component,
                "footprint": footprint, "visual_only": "true"})
    staged_source = source
    for start, end, replacement in sorted(edits, reverse=True):
        staged_source = staged_source[:start] + replacement + staged_source[end:]
    if resolution is not None:
        resolution["unresolved_model_paths"] = list(dict.fromkeys(unresolved))
    if not substitutions:
        return board, []
    staged_board = output_dir / f".{board.stem}.spike-export.kicad_pcb"
    staged_board.write_text(staged_source, encoding="utf-8")
    return staged_board, substitutions
