"""Atomic, manifest-bound board and external assembly imports into saved projects."""
from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from .assembly_designs import canonicalize_assembly_designs
from .assembly_exchange import import_exchange
from .assembly_frames import IDENTITY, resolve_world
from .assembly_scale import MAX_BOARDS
from .spider_v2 import AssemblyIRV1, BoardInstance
from .spider_v2_schema import CoordinateFrame, content_digest
from .project_package import ProjectPackageError, _source_member_name, read_project, write_spike_package
from .service_project import import_design
from .harness_authoring import validate_harness_connections


def _source_paths(params):
    if "source_paths" in params:
        values = params["source_paths"]
        if not isinstance(values, list) or not 1 <= len(values) <= MAX_BOARDS:
            raise ValueError(f"source_paths must contain 1 through {MAX_BOARDS} files.")
    else:
        values = [params["source_path"]]
    if any(not isinstance(value, str) or not value.strip() for value in values):
        raise ValueError("Every assembly import source must be a non-empty path.")
    sources = [Path(value) for value in values]
    if any(source.suffix.lower() not in {".kicad_pcb", ".ipc2581", ".spikeassembly"} for source in sources):
        raise ValueError("Assembly import supports .kicad_pcb, .ipc2581, and .spikeassembly files.")
    return sources


def _board_bounds(design):
    """Conservative local XY envelope; unknown extents reserve one square metre."""
    metadata = design.get("metadata") or {}
    declared = metadata.get("board_bounds_mm") or metadata.get("board_bbox")
    if isinstance(declared, dict):
        keys = ("min_x_mm", "min_y_mm", "max_x_mm", "max_y_mm") if "min_x_mm" in declared else ("min_x", "min_y", "max_x", "max_y")
        values = [float(declared[key]) for key in keys]
        return values[0], values[1], values[2], values[3]
    if isinstance(declared, (list, tuple)) and len(declared) == 4:
        return tuple(float(value) for value in declared)
    size = metadata.get("board_size_mm")
    if isinstance(size, dict):
        size = (size.get("width_mm"), size.get("height_mm"))
    if isinstance(size, (list, tuple)) and len(size) == 2:
        width, height = (float(value) for value in size)
        return -width / 2, -height / 2, width / 2, height / 2
    return -500.0, -500.0, 500.0, 500.0


def _right_edge(assembly, designs):
    right = 0.0
    for board in assembly.boards:
        design = designs.get(board.design_id)
        if design is None:
            continue
        x0, y0, x1, y1 = _board_bounds(design)
        transform = resolve_world(assembly, board.frame)
        for x in (x0, x1):
            for y in (y0, y1):
                right = max(right, transform[0] * x + transform[1] * y + transform[3])
    return right


def _merge_artifacts(target, additions, kind):
    for name, data in additions.items():
        if name in target and target[name] != data:
            raise ProjectPackageError(f"Imported {kind} artifact {name} conflicts with another selected source.")
        target[name] = data


def import_into_assembly(params, *, application_version):
    sources = _source_paths(params)
    path = Path(params["project_path"])
    opened = read_project(path, include_members=True)
    expected = params.get("expected_manifest_payload_sha256")
    if opened.migrated or not expected or expected != opened.manifest.get("manifest_payload_sha256"):
        raise ProjectPackageError("The project changed since it was verified; reopen and save it before importing.")
    payload = dict(opened.payload)
    active = payload["design_ir"]
    assembly = AssemblyIRV1.from_dict(payload["assembly_ir"]) if payload.get("assembly_ir") else AssemblyIRV1(assembly_id=str(uuid4()), name="Assembly")
    if not assembly.boards:
        identifier = str(uuid4())
        assembly.boards.append(BoardInstance(id=identifier, name=active["name"], design_id=active["design_id"], frame=CoordinateFrame(frame_id=identifier + "-frame", parent_frame_id=assembly.frame.frame_id)))
    retained = {d["design_id"]: d for d in (payload.get("assembly_designs") or {}).get("designs", [active])}
    if len(assembly.boards) + len(sources) > MAX_BOARDS:
        raise ValueError(f"AssemblyIR supports at most {MAX_BOARDS} board instances.")
    raw = assembly.to_dict()
    models = {m["id"]: m for m in (payload.get("models") or {}).get("models", [])}
    model_artifacts, source_artifacts, reports, source_results = {}, {}, [], []
    placement_right = _right_edge(assembly, retained)

    for source in sources:
        if source.suffix.lower() == ".spikeassembly":
            imported = import_exchange(source, root_frame=assembly.frame.frame_id, namespace=str(uuid4()))
        else:
            source_bytes = source.read_bytes()
            try:
                outcome = import_design(str(source), with_report=True)
            except RuntimeError as exc:
                raise ValueError(f"Cannot import board {source.name}: {exc}") from exc
            design = outcome["design"]
            source_digest = content_digest(source_bytes)
            if design["source"]["source_digest"] != source_digest:
                raise ProjectPackageError("The board source changed during import; retry from a stable source file.")
            design["source"]["artifact_path"] = "package:" + _source_member_name(source.name, source_digest)
            identifier = str(uuid4())
            transform = list(IDENTITY)
            x0, _, x1, _ = _board_bounds(design)
            transform[3] = placement_right + 50.0 - x0
            placement_right += 50.0 + (x1 - x0)
            board = BoardInstance(id=identifier, name=design["name"], design_id=design["design_id"], frame=CoordinateFrame(frame_id=identifier + "-frame", parent_frame_id=assembly.frame.frame_id, transform=tuple(transform)))
            imported = {"assembly": {"boards": [board.__dict__]}, "designs": {design["design_id"]: design}, "models": [], "model_artifacts": {},
                "source_artifacts": {source_digest + "-" + source.name: source_bytes}, "reports": [outcome["report"]]}
        for key, design in imported["designs"].items():
            if key in retained and content_digest(retained[key]) != content_digest(design):
                raise ProjectPackageError(f"Imported SpiDeR identity {key} conflicts with the retained design.")
            retained.setdefault(key, design)
        for collection in ("boards", "parts", "harnesses", "connector_mappings"):
            raw[collection].extend(imported["assembly"].get(collection, []))
        if source.suffix.lower() == ".spikeassembly":
            # Subsequent native boards must clear the explicitly placed exchange.
            placement_right = max(placement_right, _right_edge(AssemblyIRV1.from_dict(raw), retained))
        for model in imported["models"]:
            if model["id"] in models and models[model["id"]] != model:
                raise ProjectPackageError(f"Imported model identity {model['id']} conflicts with a retained model.")
            models[model["id"]] = model
        _merge_artifacts(model_artifacts, imported["model_artifacts"], "model")
        _merge_artifacts(source_artifacts, imported["source_artifacts"], "source")
        source_reports = imported["reports"]
        reports.extend(source_reports)
        source_results.append({"source_name": source.name, "board_count": len(imported["assembly"].get("boards", [])),
            "part_count": len(imported["assembly"].get("parts", [])), "reports": source_reports})
        if len(raw["boards"]) > MAX_BOARDS:
            raise ValueError(f"AssemblyIR supports at most {MAX_BOARDS} board instances.")

    assembly = AssemblyIRV1.from_dict(raw)
    validate_harness_connections(assembly)
    payload["assembly_ir"] = assembly.to_dict()
    payload["assembly_designs"] = canonicalize_assembly_designs({"contract": "spike/assembly-designs/v1", "active_design_id": active["design_id"], "designs": list(retained.values())}, active, payload["assembly_ir"])
    payload["models"] = {**(payload.get("models") or {}), "contract": "spike/model-index/v1", "models": list(models.values())}
    payload["audit"] = [*(payload.get("audit") or []), {"event": "assembly_sources_imported", "source_name": sources[0].name,
        "source_names": [source.name for source in sources], "board_count": sum(item["board_count"] for item in source_results),
        "part_count": sum(item["part_count"] for item in source_results), "reports": reports}]
    if read_project(path).manifest.get("manifest_payload_sha256") != expected:
        raise ProjectPackageError("The project changed during import; reopen before retrying.")
    manifest = write_spike_package(path, payload, preserved_members=opened.members, model_artifacts=model_artifacts,
        source_artifacts=source_artifacts, profile=opened.manifest.get("profile", "portable_project"), application_version=application_version)
    return {"contract": "spike/assembly-import-result/v1", "manifest": manifest, "board_count": len(assembly.boards),
        "part_count": len(assembly.parts), "reports": reports, "sources": source_results}
