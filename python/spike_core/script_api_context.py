# SPDX-License-Identifier: Apache-2.0
"""Validation and normalization for Python workspace script context."""

from __future__ import annotations

import json
from typing import Any


MAX_WORKSPACE_BOARDS = 256
MAX_ID_CHARS = 256
MAX_NAME_CHARS = 512
MAX_UI_ACTIONS = 64
UI_PANELS = frozenset({"layers", "nets", "connector_links", "results", "issues"})


def _text(value: Any, label: str, *, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonempty string.")
    if len(value) > maximum:
        raise ValueError(f"{label} exceeds {maximum} characters.")
    return value


def _json_copy(value: Any, label: str) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must contain finite JSON-compatible values.") from exc


def normalize_script_workspace(
    workspace: Any,
    legacy_design: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Return a detached occurrence-scoped workspace and selected design.

    The legacy single-design input is projected as one occurrence only when a
    workspace snapshot is absent. Equal board names and equal design IDs never
    establish occurrence identity.
    """
    if workspace is None:
        if legacy_design is None:
            return {"boards": [], "selected_board_id": None, "assembly": {}}, None
        design = _json_copy(legacy_design, "Python script design context")
        design_id = _text(design.get("design_id"), "design.design_id", maximum=MAX_ID_CHARS)
        name = design.get("name") or design_id
        if not isinstance(name, str) or len(name) > MAX_NAME_CHARS:
            raise ValueError(f"design.name must be at most {MAX_NAME_CHARS} characters.")
        board = {"id": design_id, "name": name, "design_id": design_id, "design": design}
        return {"boards": [board], "selected_board_id": design_id, "assembly": {}}, design

    if not isinstance(workspace, dict):
        raise ValueError("Python script workspace context must be an object.")
    copied = _json_copy(workspace, "Python script workspace context")
    boards = copied.get("boards")
    if not isinstance(boards, list):
        raise ValueError("Python script workspace.boards must be an array.")
    if len(boards) > MAX_WORKSPACE_BOARDS:
        raise ValueError(f"Python script workspace exceeds {MAX_WORKSPACE_BOARDS} boards.")

    normalized: list[dict[str, Any]] = []
    occurrence_ids: set[str] = set()
    for index, raw in enumerate(boards):
        label = f"workspace.boards[{index}]"
        if not isinstance(raw, dict):
            raise ValueError(f"{label} must be an object.")
        occurrence_id = _text(raw.get("id"), f"{label}.id", maximum=MAX_ID_CHARS)
        if occurrence_id in occurrence_ids:
            raise ValueError(f"Duplicate workspace board occurrence ID: {occurrence_id}")
        occurrence_ids.add(occurrence_id)
        name = _text(raw.get("name"), f"{label}.name", maximum=MAX_NAME_CHARS)
        design_id = _text(raw.get("design_id"), f"{label}.design_id", maximum=MAX_ID_CHARS)
        design = raw.get("design")
        if not isinstance(design, dict):
            raise ValueError(f"{label}.design must be a SpiDeR object.")
        embedded_design_id = design.get("design_id")
        if embedded_design_id is not None and embedded_design_id != design_id:
            raise ValueError(f"{label}.design_id does not match design.design_id.")
        normalized.append({"id": occurrence_id, "name": name,
                           "design_id": design_id, "design": design})

    selected = copied.get("selected_board_id")
    if selected is not None:
        selected = _text(selected, "workspace.selected_board_id", maximum=MAX_ID_CHARS)
        if selected not in occurrence_ids:
            raise ValueError(f"Unknown workspace selected board occurrence ID: {selected}")
    assembly = copied.get("assembly", {})
    if assembly is None:
        assembly = {}
    if not isinstance(assembly, dict):
        raise ValueError("Python script workspace.assembly must be an object or null.")

    selected_design = next(
        (board["design"] for board in normalized if board["id"] == selected), None,
    )
    if legacy_design is not None:
        legacy = _json_copy(legacy_design, "Python script design context")
        if selected_design is not None and legacy.get("design_id") != selected_design.get("design_id"):
            raise ValueError("Python script design does not match the selected workspace board.")
        selected_design = legacy
    return {"boards": normalized, "selected_board_id": selected, "assembly": assembly}, selected_design


def admit_ui_actions(value: Any, workspace: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate the untrusted child response before UI actions reach the host."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_UI_ACTIONS:
        raise ValueError(f"Python UI actions must be an array of at most {MAX_UI_ACTIONS} items.")
    boards = {item["id"]: item for item in workspace.get("boards", [])}
    admitted: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"Python UI action {index + 1} must be an object.")
        action = raw.get("action")
        if action == "focus_board":
            if set(raw) != {"action", "board_id"} or raw.get("board_id") not in boards:
                raise ValueError(f"Python UI action {index + 1} references an unknown board.")
        elif action == "select_net":
            if set(raw) != {"action", "board_id", "net_id"} or raw.get("board_id") not in boards:
                raise ValueError(f"Python UI action {index + 1} has an invalid net selection.")
            net_id = raw.get("net_id")
            if isinstance(net_id, bool) or not isinstance(net_id, (str, int)):
                raise ValueError(f"Python UI action {index + 1} has an invalid net ID.")
            nets = boards[raw["board_id"]]["design"].get("nets", [])
            if not isinstance(nets, list) or not any(
                isinstance(net, dict) and (net.get("id") == net_id or net.get("net_id") == net_id)
                for net in nets
            ):
                raise ValueError(f"Python UI action {index + 1} references an unknown board net.")
        elif action == "open_panel":
            if set(raw) != {"action", "panel"} or raw.get("panel") not in UI_PANELS:
                raise ValueError(f"Python UI action {index + 1} references an unsupported panel.")
        else:
            raise ValueError(f"Python UI action {index + 1} has an unsupported action.")
        admitted.append(_json_copy(raw, f"Python UI action {index + 1}"))
    return admitted


__all__ = ["MAX_UI_ACTIONS", "MAX_WORKSPACE_BOARDS", "UI_PANELS",
           "admit_ui_actions", "normalize_script_workspace"]
