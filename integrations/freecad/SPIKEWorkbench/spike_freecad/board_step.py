# SPDX-License-Identifier: MIT
"""Bounded KiCad STEP export preparation and FreeCAD document import."""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
from pathlib import Path
from typing import Iterable


MAX_STEP_BYTES = 512 * 1024 * 1024
_STEP_PREFIX = b"ISO-10303-21;"


def _executable(path: Path) -> bool:
    return path.is_file() and (os.name == "nt" or os.access(path, os.X_OK))


def discover_kicad_cli(
    configured_path: str = "",
    *,
    path_env: str | None = None,
    common_paths: Iterable[str] | None = None,
) -> str | None:
    """Return the first usable kicad-cli from a setting, PATH, or known installs.

    ``path_env`` and ``common_paths`` are injectable so discovery can be tested
    without changing the process environment.
    """
    if configured_path.strip():
        candidate = Path(configured_path).expanduser()
        if _executable(candidate):
            return str(candidate.resolve())

    executable = "kicad-cli.exe" if os.name == "nt" else "kicad-cli"
    found = shutil.which(executable, path=path_env) if path_env is not None else shutil.which(executable)
    if found and _executable(Path(found)):
        return str(Path(found).resolve())

    candidates = list(common_paths or ())
    if common_paths is None and os.name == "nt":
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        candidates.extend(
            str(Path(program_files) / "KiCad" / version / "bin" / "kicad-cli.exe")
            for version in ("10.0", "9.0", "8.0")
        )
    elif common_paths is None and sys.platform == "darwin":
        candidates.append("/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli")
    elif common_paths is None:
        candidates.extend(("/usr/bin/kicad-cli", "/usr/local/bin/kicad-cli"))
    for value in candidates:
        candidate = Path(value).expanduser()
        if candidate.is_dir():
            candidate /= executable
        if _executable(candidate):
            return str(candidate.resolve())
    return None


def validate_step_paths(source: str, destination: str) -> tuple[str, str]:
    """Validate and normalize a saved KiCad board and a new STEP destination."""
    board = Path(source).expanduser().resolve()
    output = Path(destination).expanduser().resolve()
    if not board.is_file() or board.suffix.lower() != ".kicad_pcb":
        raise ValueError("Select an existing .kicad_pcb source file.")
    if output.suffix.lower() not in (".step", ".stp"):
        raise ValueError("The KiCad export destination must end in .step or .stp.")
    if output == board:
        raise ValueError("The STEP destination must differ from the KiCad source.")
    if not output.parent.is_dir():
        raise ValueError("The STEP destination directory does not exist.")
    if output.exists() and not output.is_file():
        raise ValueError("The STEP destination is not a regular file.")
    return str(board), str(output)


def build_step_export_arguments(
    source: str, destination: str, *, kind: str = "board"
) -> list[str]:
    """Build fixed KiCad 10 CLI arguments; the caller owns QProcess execution."""
    board, output = validate_step_paths(source, destination)
    if kind == "board":
        options = [
            "--force", "--subst-models", "--board-only", "--include-tracks",
            "--include-pads", "--include-zones", "--include-inner-copper",
            "--cut-vias-in-body",
        ]
    elif kind == "components":
        # KiCad may substitute an installed STEP/IGS twin for a VRML model;
        # it still reports references for which no actual model is available.
        options = ["--force", "--subst-models", "--no-board-body"]
    else:
        raise ValueError("STEP export kind must be 'board' or 'components'.")
    return ["pcb", "export", "step", *options, "--output", output, board]


def validate_step_artifact(path: str, *, max_bytes: int = MAX_STEP_BYTES) -> tuple[str, int]:
    """Validate a bounded, complete-looking ISO 10303-21 artifact."""
    artifact = Path(path).expanduser().resolve()
    if not artifact.is_file():
        raise ValueError("KiCad did not create the STEP artifact.")
    size = artifact.stat().st_size
    if size < len(_STEP_PREFIX) + len(b"END-ISO-10303-21;"):
        raise ValueError("KiCad created an empty or truncated STEP artifact.")
    if size > max_bytes:
        raise ValueError(f"STEP artifact exceeds the {max_bytes} byte import limit.")
    with artifact.open("rb") as stream:
        if stream.read(256).lstrip()[: len(_STEP_PREFIX)].upper() != _STEP_PREFIX:
            raise ValueError("Artifact is not an ISO 10303-21 STEP file.")
        stream.seek(max(0, size - 512))
        if b"END-ISO-10303-21;" not in stream.read(512).upper():
            raise ValueError("STEP artifact is incomplete (missing end marker).")
    return str(artifact), size


def _digest(path: str) -> str:
    value = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def _string(obj, name: str, value: object) -> None:
    if name not in obj.PropertiesList:
        obj.addProperty("App::PropertyString", name, "SPIKE Link")
    setattr(obj, name, str(value))


def apply_step_to_document(
    document,
    source: str,
    artifact: str,
    *,
    kind: str = "board",
    expected_source_digest: str = "",
    export_warnings: str = "",
):
    """Replace SPIKE link geometry with one detailed, approximate STEP feature.

    FreeCAD and Part are imported lazily so the validation helpers remain usable
    in ordinary Python. Missing/substituted KiCad models must be passed through
    ``export_warnings``; this function never upgrades the result to complete.
    """
    import Part  # type: ignore

    if kind not in ("board", "components"):
        raise ValueError("STEP import kind must be 'board' or 'components'.")
    board, _ = validate_step_paths(source, artifact)
    try:
        step, size = validate_step_artifact(artifact)
    except ValueError as error:
        if kind == "components":
            raise ValueError(
                f"Component STEP import is unavailable: {error} "
                "KiCad may not have resolved any component models."
            ) from error
        raise
    digest = _digest(board)
    if expected_source_digest and digest != expected_source_digest:
        raise ValueError("KiCad source changed during STEP export. Refresh the link again.")
    shape = Part.read(step)
    if shape is None or getattr(shape, "isNull", lambda: False)():
        detail = (" No component models may have been resolved by KiCad."
                  if kind == "components" else "")
        raise ValueError("FreeCAD could not read usable geometry from the STEP artifact." + detail)

    group = next((obj for obj in document.Objects
                  if obj.TypeId == "App::DocumentObjectGroup"
                  and "SPIKEKiCadSource" in obj.PropertiesList), None)
    reference_objects = [] if group is None else [
        obj for obj in list(group.Group)
        if "SPIKEGeometryStatus" in obj.PropertiesList
        and obj.SPIKEGeometryStatus == "reference_only"
    ]
    previous_visibility = [
        (obj.ViewObject, obj.ViewObject.Visibility)
        for obj in reference_objects if obj.ViewObject is not None
    ]
    document.openTransaction("Import detailed KiCad STEP")
    try:
        if group is None:
            group = document.addObject("App::DocumentObjectGroup", "SPIKEKiCadLink")
            group.Label = "SPIKE linked KiCad board"
        previous_statuses = ({"detailed_step_approximate", "detailed_step_board_approximate",
                              "detailed_step_copper_approximate"}
                             if kind == "board" else {"detailed_step_components_approximate"})
        previous_steps = [
            obj for obj in list(group.Group)
            if "SPIKEGeometryStatus" in obj.PropertiesList
            and str(obj.SPIKEGeometryStatus) in previous_statuses
        ]
        for obj in previous_steps:
            document.removeObject(obj.Name)
        object_name = "SPIKEBoardSTEP" if kind == "board" else "SPIKEComponentsSTEP"
        feature = document.addObject("Part::Feature", object_name)
        feature.Label = ("KiCad substrate (detailed STEP, approximate)" if kind == "board"
                         else "KiCad components (resolved STEP models, approximate)")
        copper_shape = None
        if kind == "board":
            solids = list(getattr(shape, "Solids", ()))
            volumes = [float(getattr(solid, "Volume", 0.0)) for solid in solids]
            total = sum(volume for volume in volumes if volume > 0.0)
            if len(solids) > 1 and total > 0.0:
                largest = max(range(len(solids)), key=lambda index: volumes[index])
                if volumes[largest] >= 0.5 * total:
                    feature.Shape = solids[largest]
                    copper_shape = Part.makeCompound([solid for index, solid in enumerate(solids)
                                                      if index != largest])
                else:
                    feature.Shape = shape
            else:
                feature.Shape = shape
        else:
            feature.Shape = shape
        if feature.ViewObject is not None:
            feature.ViewObject.ShapeColor = ((0.12, 0.38, 0.25) if kind == "board"
                                             else (0.70, 0.77, 0.84))
            feature.ViewObject.LineColor = ((0.06, 0.22, 0.14) if kind == "board"
                                            else (0.27, 0.34, 0.41))
        status = f"detailed_step_{kind}_approximate"
        _string(feature, "SPIKEGeometryStatus", status)
        _string(feature, "SPIKEStepKind", kind)
        _string(feature, "SPIKEColorRole", "substrate_green" if kind == "board" else "model_silver")
        _string(feature, "SPIKESourceSHA256", digest)
        _string(feature, "SPIKEStepArtifact", step)
        _string(feature, "SPIKEStepBytes", size)
        _string(feature, "SPIKEExportWarnings", export_warnings.strip())
        group.addObject(feature)
        if copper_shape is not None:
            copper = document.addObject("Part::Feature", "SPIKECopperSTEP")
            copper.Label = "KiCad copper, pads, tracks and vias (STEP, approximate)"
            copper.Shape = copper_shape
            if copper.ViewObject is not None:
                copper.ViewObject.ShapeColor = (0.82, 0.53, 0.18)
                copper.ViewObject.LineColor = (0.38, 0.23, 0.08)
            _string(copper, "SPIKEGeometryStatus", "detailed_step_copper_approximate")
            _string(copper, "SPIKEStepKind", "copper")
            _string(copper, "SPIKEColorRole", "copper_gold")
            _string(copper, "SPIKESourceSHA256", digest)
            _string(copper, "SPIKEStepArtifact", step)
            _string(copper, "SPIKEExportWarnings", export_warnings.strip())
            group.addObject(copper)
        _string(group, "SPIKEKiCadSource", board)
        _string(group, "SPIKEKiCadSHA256", digest)
        _string(group, "SPIKEGeometryStatus", status)
        _string(group, "SPIKEExportWarnings", export_warnings.strip())
        # Keep marker objects and their source metadata for selection while the
        # detailed STEP supplies the visible board geometry.
        if kind == "board":
            for obj in reference_objects:
                if obj.ViewObject is not None:
                    obj.ViewObject.Visibility = False
        document.recompute()
        document.commitTransaction()
    except Exception:
        document.abortTransaction()
        # View-provider state is not consistently covered by document undo in
        # every supported FreeCAD build, so restore it explicitly.
        for view, visibility in previous_visibility:
            view.Visibility = visibility
        raise
    return feature
