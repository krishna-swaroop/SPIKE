"""Manifest-bound AssemblyIR structure operations and request routing."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping

from .assembly_designs import AssemblyDesignError, canonicalize_assembly_designs
from .spider_v2 import AssemblyIRV1
from .project_package import ProjectPackageError, read_project, write_spike_package
from .service_project_persistence import without_saved_results
from .service_helpers import error_response, operation_id
from .service_project_geometric_constraint import apply_assembly_geometric_constraint_in_project
from .service_assembly_import import import_into_assembly
from .harness_authoring import validate_harness_connections
from .assembly_frames import validate_rigid_transform
from .service_mcad_collaboration import export_mcad_session, preview_mcad_feedback, apply_mcad_feedback
from .multiboard_study import save_multiboard_study_in_project


def _endpoint_board_id(value: Any) -> str:
    """Return only an explicit occurrence identity from an assembly endpoint."""

    return value.split(":", 1)[0].strip() if isinstance(value, str) else ""


def _record_board_ids(record: Any, fields: Iterable[str]) -> set[str]:
    if not isinstance(record, Mapping) or not isinstance(record.get("data"), Mapping):
        return set()
    data = record["data"]
    result = {
        str(data[field]).strip()
        for field in fields
        if isinstance(data.get(field), str) and str(data[field]).strip()
    }
    for field in ("endpoint_a", "endpoint_b"):
        if field in data:
            board_id = _endpoint_board_id(data[field])
            if board_id:
                result.add(board_id)
    return result


def _endpoint_record_board_ids(record: Any) -> set[str]:
    if not isinstance(record, Mapping):
        return set()
    return {
        board_id
        for field in ("endpoint_a", "endpoint_b")
        for board_id in [_endpoint_board_id(record.get(field))]
        if board_id
    }


def _prune_removed_board_references(
    replacement: Dict[str, Any], original: AssemblyIRV1, removed_board_ids: set[str],
) -> Dict[str, int]:
    """Drop only records that explicitly name a removed board occurrence."""

    counts: Dict[str, int] = {}

    def prune(field: str, references) -> None:
        before = replacement.get(field, [])
        if not isinstance(before, list):
            return
        replacement[field] = [item for item in before if not (references(item) & removed_board_ids)]
        counts[field] = len(before) - len(replacement[field])

    prune("harnesses", _endpoint_record_board_ids)
    prune("connector_mappings", lambda item: _record_board_ids(item, ("board_id",)))
    prune("rigid_flex_links", lambda item: _record_board_ids(item, ("board_a_id", "board_b_id")))
    prune("thermal_contacts", _endpoint_record_board_ids)
    prune("electrical_bonds", _endpoint_record_board_ids)

    if not removed_board_ids:
        return counts
    removed_frames = {board.frame.frame_id for board in original.boards if board.id in removed_board_ids}
    dependents = [
        f"board {item.get('id', '<unknown>')}"
        for item in replacement.get("boards", [])
        if isinstance(item, Mapping)
        and isinstance(item.get("frame"), Mapping)
        and item["frame"].get("parent_frame_id") in removed_frames
    ]
    dependents.extend(
        f"part {entity.id}"
        for entity in original.parts
        if entity.frame.parent_frame_id in removed_frames
    )
    if dependents:
        raise ProjectPackageError(
            "Cannot remove board occurrence(s) "
            f"{', '.join(sorted(removed_board_ids))}: {', '.join(dependents)} depends on a removed board frame. "
            "Reparent the dependent entity with its dedicated placement transaction before removing the board."
        )
    return counts


def _validate_occurrence_references(assembly: AssemblyIRV1) -> None:
    board_ids = {board.id for board in assembly.boards}
    for mapping in assembly.connector_mappings:
        if not isinstance(mapping.data, dict):
            raise ProjectPackageError(f"Connector mapping {mapping.id} data must be an object.")
        for field in ("board_id", "endpoint_a", "endpoint_b"):
            if field not in mapping.data:
                continue
            value = mapping.data[field]
            board_id = value.strip() if field == "board_id" and isinstance(value, str) else _endpoint_board_id(value)
            if not board_id or board_id not in board_ids:
                raise ProjectPackageError(
                    f"Connector mapping {mapping.id} {field} must resolve to a retained board occurrence."
                )
    for link in assembly.rigid_flex_links:
        if not isinstance(link.data, dict):
            raise ProjectPackageError(f"Rigid-flex link {link.id} data must be an object.")
        endpoints = [link.data.get("board_a_id"), link.data.get("board_b_id")]
        if any(not isinstance(value, str) or not value.strip() or value not in board_ids for value in endpoints):
            raise ProjectPackageError(f"Rigid-flex link {link.id} must resolve to retained board occurrences.")
        if endpoints[0] == endpoints[1]:
            raise ProjectPackageError(f"Rigid-flex link {link.id} must join distinct board occurrences.")


def _prune_removed_entity_bindings(
    raw: Any, removed_contacts: set[str], removed_bonds: set[str],
) -> tuple[Any, Dict[str, int]]:
    if not isinstance(raw, Mapping) or not raw:
        return raw, {"thermal_contact_bindings": 0, "electrical_bond_bindings": 0}
    updated = copy.deepcopy(dict(raw))
    counts: Dict[str, int] = {}
    for field, removed in (
        ("thermal_contact_bindings", removed_contacts),
        ("electrical_bond_bindings", removed_bonds),
    ):
        values = updated.get(field)
        if not isinstance(values, list):
            counts[field] = 0
            continue
        updated[field] = [
            item for item in values
            if not isinstance(item, Mapping) or item.get("assembly_entity_id") not in removed
        ]
        counts[field] = len(values) - len(updated[field])
    return updated, counts


def _invalidate_saved_results(payload: Dict[str, Any], before_assembly: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    """Archive result-bearing state, then remove it from the active assembly."""

    cleaned = without_saved_results(payload)
    result_fields = {
        "latest_result", "active_result", "latest_channel_result", "field_result", "screening", "result",
    }

    def clear_nested(value: Any) -> None:
        if isinstance(value, dict):
            if value.get("contract") == "spike/assembly-field-study-file/v1":
                return
            for key in list(value):
                if key in result_fields:
                    value[key] = None
                elif key == "result_history":
                    value[key] = []
                else:
                    clear_nested(value[key])
        elif isinstance(value, list):
            for item in value:
                clear_nested(item)

    clear_nested(cleaned.get("analyses"))
    cleaned_extensions = cleaned.get("extensions")
    if isinstance(cleaned_extensions, dict):
        legacy_cleaned = cleaned_extensions.get("legacy")
        if isinstance(legacy_cleaned, dict):
            for key in ("analysis", "thermal", "emi", "spice"):
                clear_nested(legacy_cleaned.get(key))
    changed = any(
        payload.get(key) != cleaned.get(key)
        for key in ("results", "analyses", "assembly_ir", "extensions")
    )
    if not changed:
        return payload, False
    legacy = (payload.get("extensions") or {}).get("legacy") or {}
    extensions = cleaned.setdefault("extensions", {})
    if not isinstance(extensions, dict):
        raise ProjectPackageError("Project extensions must be an object before assembly result invalidation.")
    extension = extensions.setdefault(
        "spike.assembly-structure-history", {"contract": "spike/assembly-structure-history/v1", "previous_states": []},
    )
    if not isinstance(extension, dict) or not isinstance(extension.get("previous_states"), list):
        raise ProjectPackageError("Assembly structure history is malformed; repair it before changing the assembly.")
    extension.setdefault("previous_states", []).append({
        "assembly_ir": copy.deepcopy(before_assembly),
        "results": copy.deepcopy(payload.get("results")),
        "analyses": copy.deepcopy(payload.get("analyses")),
        "desktop_state": {
            key: copy.deepcopy(legacy[key])
            for key in ("analysis", "results", "thermal", "emi", "spice")
            if key in legacy
        },
    })
    return cleaned, True


def update_assembly_structure_in_project(params: Dict[str, Any], *, application_version: str) -> Dict[str, Any]:
    fields = ("boards", "harnesses", "connector_mappings", "rigid_flex_links")
    allowed = {"project_path", "expected_manifest_payload_sha256", *fields}
    if set(params) != allowed:
        raise ProjectPackageError("Assembly structure updates require only project identity and the four structure arrays.")
    path = Path(str(params.get("project_path", "")))
    if not path.is_file():
        raise ProjectPackageError("Open a saved SPIKE project before editing assembly structure.")
    opened = read_project(path, include_members=True)
    if opened.migrated:
        raise ProjectPackageError("Migrate and save the legacy project before editing assembly structure.")
    expected = str(params.get("expected_manifest_payload_sha256", "")).strip().lower()
    actual = str(opened.manifest.get("manifest_payload_sha256", "")).strip().lower()
    if not expected or expected != actual:
        raise ProjectPackageError("The project changed since it was verified; reopen it before editing assembly structure.")
    assembly_raw = opened.payload.get("assembly_ir")
    if not isinstance(assembly_raw, dict):
        raise ProjectPackageError("The project does not contain an editable AssemblyIR assembly.")
    original = AssemblyIRV1.from_dict(assembly_raw)
    replacement = dict(assembly_raw)
    for field in fields:
        value = params.get(field)
        if not isinstance(value, list):
            raise ProjectPackageError(f"AssemblyIR {field} must be an array.")
        replacement[field] = value
    proposed_board_ids = {
        str(item.get("id", "")).strip()
        for item in replacement["boards"]
        if isinstance(item, Mapping) and str(item.get("id", "")).strip()
    }
    removed_board_ids = {board.id for board in original.boards} - proposed_board_ids
    reconciled = _prune_removed_board_references(replacement, original, removed_board_ids)
    assembly = AssemblyIRV1.from_dict(replacement)
    validate_harness_connections(assembly)
    _validate_occurrence_references(assembly)
    for board in assembly.boards:
        validate_rigid_transform(board.frame.transform, f"Board {board.id} placement")
    board_ids = {board.id for board in assembly.boards}
    for harness in assembly.harnesses:
        endpoints = [harness.endpoint_a.split(":", 1)[0], harness.endpoint_b.split(":", 1)[0]]
        if any(endpoint not in board_ids for endpoint in endpoints):
            raise ProjectPackageError(f"Harness {harness.id} endpoints must resolve to retained board instances.")
        if endpoints[0] == endpoints[1]:
            raise ProjectPackageError(f"Harness {harness.id} must connect two distinct board instances.")
    retained = opened.payload.get("assembly_designs")
    active = opened.payload.get("design_ir")
    if retained:
        try:
            canonicalize_assembly_designs(retained, active, assembly.to_dict())
        except AssemblyDesignError as exc:
            raise ProjectPackageError(str(exc)) from exc
    else:
        active_id = str((active or {}).get("design_id", "")) if isinstance(active, dict) else ""
        if any(board.design_id != active_id for board in assembly.boards):
            raise ProjectPackageError("Retain every referenced SpiDeR before assigning multiple board designs.")
    payload = dict(opened.payload)
    payload["assembly_ir"] = assembly.to_dict()
    original_contacts = {item.id for item in original.thermal_contacts}
    retained_contacts = {item.id for item in assembly.thermal_contacts}
    original_bonds = {item.id for item in original.electrical_bonds}
    retained_bonds = {item.id for item in assembly.electrical_bonds}
    package_shapes, binding_counts = _prune_removed_entity_bindings(
        payload.get("assembly_package_shapes"),
        original_contacts - retained_contacts,
        original_bonds - retained_bonds,
    )
    if isinstance(package_shapes, Mapping) and package_shapes:
        payload["assembly_package_shapes"] = package_shapes
    reconciled.update(binding_counts)
    structure_changed = assembly.to_dict() != original.to_dict() or any(reconciled.values())
    if structure_changed and str(opened.manifest.get("profile")) == "result_bundle":
        raise ProjectPackageError(
            "Assembly structure changes invalidate result-bundle outputs. Save an editable portable project before changing the assembly."
        )
    results_invalidated = False
    if structure_changed:
        payload, results_invalidated = _invalidate_saved_results(payload, original.to_dict())
    saved_assembly = payload["assembly_ir"]
    audit = list(payload.get("audit") or [])
    audit.append({
        "event": "assembly_structure_updated",
        "board_count": len(assembly.boards), "harness_count": len(assembly.harnesses),
        "connector_mapping_count": len(assembly.connector_mappings),
        "rigid_flex_link_count": len(assembly.rigid_flex_links),
        "retained_design_count": len((retained or {}).get("designs", [])) if isinstance(retained, dict) else 1,
        "removed_board_ids": sorted(removed_board_ids),
        "reconciled_reference_counts": reconciled,
        "results_invalidated": results_invalidated,
        "coupled_solver_ready": False,
    })
    payload["audit"] = audit
    manifest = write_spike_package(
        path, payload, profile=str(opened.manifest.get("profile", "portable_project")),
        preserved_members=opened.members, application_version=application_version,
    )
    return {
        "contract": "spike/assembly-structure-update-result/v1",
        "assembly_ir": saved_assembly, "project_path": str(path.resolve()),
        "removed_board_ids": sorted(removed_board_ids),
        "reconciled_reference_counts": reconciled,
        "results_invalidated": results_invalidated,
        "coupled_solver_ready": False, "manifest": manifest,
    }


def handle_assembly_project_request(method: Any, params: Dict[str, Any], *, request_id: Any, application_version: str) -> Dict[str, Any] | None:
    operations = {
        "save_multiboard_study_in_project": save_multiboard_study_in_project,
        "export_mcad_session": export_mcad_session,
        "preview_mcad_feedback": preview_mcad_feedback,
        "apply_mcad_feedback": apply_mcad_feedback,
        "import_into_assembly_project": import_into_assembly,
        "apply_assembly_geometric_constraint_in_project": apply_assembly_geometric_constraint_in_project,
        "update_assembly_structure_in_project": update_assembly_structure_in_project,
    }
    operation = operations.get(method)
    if operation is None:
        return None
    try:
        return {"ok": True, "result": operation(params, application_version=application_version)}
    except (OSError, KeyError, AttributeError, ValueError, TypeError, ProjectPackageError) as exc:
        return error_response("SPIKE-BE-PACKAGE-E-0002", str(exc), error_type=type(exc).__name__, operation_id=operation_id(request_id))
