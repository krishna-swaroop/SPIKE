"""Offline 3D model manifest generation.

STEP/STP is retained as the source format. The web renderer consumes glTF, so
conversion is an explicit pipeline step rather than an implicit best effort.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import glob
import os
import re
import shutil
import subprocess
import struct
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Iterable, List

MODEL_SUFFIXES = {".step", ".stp", ".wrl", ".vrml", ".glb", ".gltf"}
MAX_VISUAL_BUNDLE_SOURCE_BYTES = 64 * 1024 * 1024
MAX_VISUAL_BUNDLE_ARTIFACT_BYTES = 96 * 1024 * 1024


def automatic_component_model_overrides(
    source: str, additional_roots: Iterable[str | Path] = (),
) -> Dict[str, str]:
    from .model_resolver_staging import automatic_component_model_overrides as resolve_components
    return resolve_components(source, additional_roots)


def model_library_roots(additional_roots: Iterable[str | Path] = ()) -> List[Path]:
    candidates: List[Path] = [Path(item).expanduser() for item in additional_roots]
    configured = os.environ.get("SPIKE_MODEL_LIBRARY", "")
    if configured:
        candidates.extend(Path(item) for item in configured.split(os.pathsep) if item)
    # KiCad keeps the version in its environment variable name. Do not limit
    # discovery to the versions known when SPIKE was released: older projects
    # and newer KiCad installations can coexist and remain valid model roots.
    for variable, value in os.environ.items():
        if re.fullmatch(r"KICAD\d+_3DMODEL_DIR", variable, re.IGNORECASE) and value:
            candidates.append(Path(value))
        elif re.fullmatch(r"KICAD\d+_3RD_PARTY", variable, re.IGNORECASE) and value:
            candidates.append(Path(value) / "3dmodels")
    # KICAD3DMOD is the pre-versioned alias used by older board libraries.
    if os.environ.get("KICAD3DMOD"):
        candidates.append(Path(os.environ["KICAD3DMOD"]))
    if os.name == "nt":
        program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        install_root = program_files / "KiCad"
        try:
            versions = [item.name for item in install_root.iterdir() if item.is_dir()]
        except OSError:
            versions = []
        versions.extend(("10.0", "9.0", "8.0", "7.0", "6.0"))
        for version in dict.fromkeys(versions):
            candidates.append(install_root / version / "share" / "kicad" / "3dmodels")
            candidates.append(Path.home() / "Documents" / "KiCad" / version / "3rdparty" / "3dmodels")
        app_data = os.environ.get("APPDATA")
        if app_data:
            candidates.append(Path(app_data) / "SPIKE" / "models")
    else:
        candidates.extend((Path.home() / ".local" / "share" / "spike" / "models", Path("/usr/share/kicad/3dmodels")))
    roots = []
    seen = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        key = os.path.normcase(str(resolved))
        if resolved.is_dir() and key not in seen:
            seen.add(key)
            roots.append(resolved)
    return roots


def search_model_library(
    query: str = "",
    limit: int = 200,
    additional_roots: Iterable[str | Path] = (),
) -> Dict[str, Any]:
    from .model_library import library_status, search_library

    indexed = search_library(query, limit, additional_roots)
    entries = []
    for item in indexed["entries"]:
        entry = dict(item)
        relative = str(entry.get("relative_path", ""))
        root = str(entry.get("root", ""))
        entry["id"] = f"{Path(root).name}:{relative}"
        entry["source"] = "kicad" if "kicad" in root.lower() else "user"
        entries.append(entry)
    status = library_status(additional_roots=additional_roots)
    return {
        "contract": "spike/model-library/v1",
        "offline": True,
        "roots": [str(item["root"]) for item in status["roots"]],
        "query": query,
        "count": len(entries),
        "truncated": bool(indexed["truncated"]),
        "formats": sorted(suffix.lstrip(".") for suffix in MODEL_SUFFIXES),
        "models": entries,
        "index": status,
    }


def _find_program(command_names: Iterable[str], search_globs: Iterable[str]) -> str:
    for command in command_names:
        found = shutil.which(command)
        if found:
            return found
    for pattern in search_globs:
        matches = [Path(item) for item in glob.glob(pattern)] if "*" in pattern else [Path(pattern)]
        for match in matches:
            if match.exists():
                return str(match)
    return ""


def converter_capabilities() -> Dict[str, Any]:
    converters = {
        "freecad": _find_program(("FreeCADCmd", "freecadcmd"), (r"C:\Program Files\FreeCAD*\bin\FreeCADCmd.exe",)),
        "assimp": shutil.which("assimp") or "",
        "blender": _find_program(("blender", "blender.exe"), (r"C:\Program Files\Blender Foundation\Blender *\blender.exe",)),
    }
    return {
        "offline": True,
        "converters": {
            name: {"available": bool(path), "path": path, "step_import": name == "freecad" and bool(path)}
            for name, path in converters.items()
        },
        "recommendation": "FreeCAD is required for STEP-to-glTF conversion; Blender can package glTF but does not natively import STEP.",
    }


def kicad_scene_capabilities() -> Dict[str, Any]:
    path = _find_program(
        ("kicad-cli", "kicad-cli.exe"),
        (
            r"C:\Program Files\KiCad\10.99\bin\kicad-cli.exe",
            r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
            r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe",
            r"C:\Program Files\KiCad\8.0\bin\kicad-cli.exe",
        ),
    )
    return {
        "available": bool(path),
        "path": path,
        "offline": True,
        "format": "glb",
        "authority": "kicad-cli",
    }


def _valid_glb(path: Path) -> bool:
    try:
        with path.open("rb") as stream:
            return path.stat().st_size > 20 and stream.read(4) == b"glTF"
    except OSError:
        return False


def _glb_external_resource_uris(path: Path) -> List[str]:
    """Return non-data resource URIs referenced by a GLB JSON chunk."""

    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        raise ValueError("Invalid GLB header.")
    declared_length = struct.unpack_from("<I", data, 8)[0]
    if declared_length != len(data):
        raise ValueError("GLB declared length does not match the artifact size.")
    offset = 12
    document: Dict[str, Any] | None = None
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        end = offset + chunk_length
        if end > len(data):
            raise ValueError("GLB chunk exceeds the artifact boundary.")
        if chunk_type == 0x4E4F534A:
            document = json.loads(data[offset:end].rstrip(b" \t\r\n\0").decode("utf-8"))
            break
        offset = end
    if not isinstance(document, dict):
        raise ValueError("GLB has no JSON document chunk.")
    uris = []
    for collection in (document.get("buffers", []), document.get("images", [])):
        if not isinstance(collection, list):
            continue
        for entry in collection:
            uri = entry.get("uri") if isinstance(entry, dict) else None
            if isinstance(uri, str) and uri and not uri.lower().startswith("data:"):
                uris.append(uri)
    return uris


def _run_kicad(command: List[str], timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=max(10, min(timeout_seconds, 600)),
        shell=False,
    )


def _missing_model_references(processes: Iterable[subprocess.CompletedProcess[str]]) -> List[str]:
    log = "\n".join(
        "\n".join((process.stdout, process.stderr))
        for process in processes
    )
    return sorted(set(re.findall(r"Could not add 3D model for ([A-Za-z0-9_.-]+)\.", log)))


def _kicad_failure_details(processes: Iterable[subprocess.CompletedProcess[str]]) -> str:
    """Retain bounded native diagnostics, with board load failures first."""
    lines = [line.strip() for process in processes for line in
             re.sub(r"\x1b\[[0-9;]*m", "", process.stderr + "\n" + process.stdout).splitlines()
             if line.strip()]
    preferred = [line for line in lines if "Failed to load board" in line]
    detail = "\n".join(dict.fromkeys(preferred or lines[-8:]))[:2000]
    return f" Native diagnostic: {detail}" if detail else ""


def _board_layers(board: Path) -> List[str]:
    source = board.read_text(encoding="utf-8", errors="replace")
    layers = re.findall(
        r'\(\s*\d+\s+"?([^"\s()]+)"?\s+'
        # Legacy KiCad visibility is a display preference, not layer removal.
        # Preserve these artifacts so SPIKE can show the layer independently.
        r'(?:signal|power|mixed|jumper|user)(?:\s+(?:"[^"]*"|hide))*\s*\)',
        source,
    )
    return list(dict.fromkeys(layers)) or ["F.Cu", "B.Cu", "Edge.Cuts"]


def _copper_layers(board: Path) -> List[str]:
    return [layer for layer in _board_layers(board) if layer.endswith(".Cu")]


def _stage_resolved_model_references(
    board: Path,
    output_dir: Path,
    model_overrides: Dict[str, str] | None = None,
    resolution: Dict[str, Any] | None = None,
    component_model_overrides: Dict[str, str] | None = None,
) -> tuple[Path, List[Dict[str, str]]]:
    from .model_resolver_staging import stage
    return stage(board, output_dir, model_overrides, resolution, component_model_overrides)

def export_kicad_scene(board_path: str | Path, output_path: str | Path, timeout_seconds: int = 180) -> Dict[str, Any]:
    board = Path(board_path).expanduser().resolve()
    output = Path(output_path).expanduser().resolve()
    if not board.is_file() or board.suffix.lower() != ".kicad_pcb":
        raise ValueError("A readable .kicad_pcb source file is required.")
    if output.suffix.lower() != ".glb":
        raise ValueError("The 3D scene output must use the .glb extension.")
    if board == output:
        raise ValueError("The scene output cannot overwrite the source board.")

    capability = kicad_scene_capabilities()
    if not capability["available"]:
        raise RuntimeError("kicad-cli is not installed or discoverable.")
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        capability["path"],
        "pcb",
        "export",
        "glb",
        "--force",
        "--subst-models",
        "--include-tracks",
        "--include-pads",
        "--include-zones",
        "--include-silkscreen",
        "--include-soldermask",
        "--output",
        str(output),
        str(board),
    ]
    process = _run_kicad(command, timeout_seconds)
    missing_references = _missing_model_references([process])
    valid = _valid_glb(output)
    if not valid:
        raise RuntimeError(f"KiCad did not create a valid GLB scene (exit code {process.returncode})." + _kicad_failure_details([process]))
    return {
        "contract": "spike/scene-manifest/v1",
        "status": "ready_with_warnings" if missing_references else "ready",
        "offline": True,
        "source": board.name,
        "scene": output.name,
        "scene_path": str(output),
        "format": "glb",
        "bytes": output.stat().st_size,
        "generator": {
            "name": "kicad-cli",
            "executable": Path(capability["path"]).name,
            "runtime_path": capability["path"],
            "exit_code": process.returncode,
        },
        "quality": {
            "missing_model_count": len(missing_references),
            "missing_references": missing_references,
            "includes": ["board", "tracks", "pads", "zones", "silkscreen", "soldermask", "component-models"],
        },
    }


def export_kicad_visual_bundle(
    board_path: str | Path,
    output_directory: str | Path,
    timeout_seconds: int = 180,
    *,
    include_layout_layers: bool = True,
    stage: str = "all",
    lightweight_board: bool = False,
    model_overrides: Dict[str, str] | None = None,
    component_model_overrides: Dict[str, str] | None = None,
) -> Dict[str, Any]:
    if stage not in {"all", "layout", "board", "components"}:
        raise ValueError("Unknown visual import stage.")
    board = Path(board_path).expanduser().resolve()
    output_dir = Path(output_directory).expanduser().resolve()
    if not board.is_file() or board.suffix.lower() != ".kicad_pcb":
        raise ValueError("A readable .kicad_pcb source file is required.")
    if board == output_dir or board.parent == output_dir and output_dir.suffix:
        raise ValueError("The visual bundle output must be a directory.")

    capability = kicad_scene_capabilities()
    if not capability["available"]:
        raise RuntimeError("kicad-cli is not installed or discoverable.")

    output_dir.mkdir(parents=True, exist_ok=True)
    resolution: Dict[str, Any] = {}
    export_board, model_substitutions = (_stage_resolved_model_references(
        board, output_dir, model_overrides, resolution, component_model_overrides,
    )
                                       if stage in {"all", "components"} else (board, []))
    from .kicad_visual_staging import stage_undefined_graphics
    model_board = export_board
    export_board, visual_repairs = stage_undefined_graphics(export_board, output_dir)
    stem = board.stem
    board_scene = output_dir / f"{stem}_board.glb"
    component_scene = output_dir / f"{stem}_components.glb"
    scene_processes = []
    scenes: Dict[str, str] = {}
    if stage in {"all", "board"}:
        command = [
            capability["path"],
            "pcb", "export", "glb",
            "--force",
            "--subst-models",
            "--board-only",
            "--include-tracks",
            "--include-pads",
            "--include-zones",
            "--include-inner-copper",
            "--include-silkscreen",
            "--include-soldermask",
            "--output", str(board_scene),
            str(export_board),
        ]
        if lightweight_board:
            command = [part for part in command if not part.startswith("--include-")]
        scene_processes.append(_run_kicad(command, timeout_seconds))
        scenes["board"] = str(board_scene)
    if stage in {"all", "components"}:
        scene_processes.append(_run_kicad([
            capability["path"],
            "pcb", "export", "glb",
            "--force",
            "--subst-models",
            "--no-board-body",
            "--output", str(component_scene),
            str(export_board),
        ], timeout_seconds))
        scenes["components"] = str(component_scene)
    invalid = [Path(path).name for path in scenes.values() if not _valid_glb(Path(path))]
    if invalid:
        codes = ", ".join(str(process.returncode) for process in scene_processes)
        raise RuntimeError(f"KiCad did not create valid split GLB scenes: {', '.join(invalid)} (exit codes {codes})." + _kicad_failure_details(scene_processes))

    layout_dir = output_dir / "layout"
    layer_files: Dict[str, str] = {}
    layout_processes: List[subprocess.CompletedProcess[str]] = []
    view_box: List[float] = []
    if include_layout_layers and stage in {"all", "layout"}:
        layout_dir.mkdir(parents=True, exist_ok=True)
        layers = _board_layers(board)
        # One board load for the whole layer table is substantially cheaper
        # than starting KiCad once per layer on 1000-2000 component designs.
        batch = _run_kicad([
            capability["path"], "pcb", "export", "svg", "--mode-multi",
            "--exclude-drawing-sheet", "--fit-page-to-board", "--drill-shape-opt", "2",
            "--layers", ",".join(layers), "--output", str(layout_dir), str(export_board),
        ], timeout_seconds)
        layout_processes.append(batch)
        aliases = dict(re.findall(
            r'\(\s*\d+\s+"?([^"\s()]+)"?\s+(?:signal|power|mixed|jumper|user)\s+"([^"\n]+)"\s*\)',
            board.read_text(encoding="utf-8", errors="replace"),
        ))
        defaults = {f"{side}.{short}": f"{side}.{long}" for side in ("F", "B")
                    for short, long in (("Adhes", "Adhesive"), ("SilkS", "Silkscreen"), ("CrtYd", "Courtyard"), ("Fab", "Fabrication"))}

        def export_layer(layer: str) -> tuple[str, Path, subprocess.CompletedProcess[str]]:
            layer_file = layout_dir / f"{stem}-{layer.replace('.', '_')}.svg"
            # KiCad names multi-file plots using display aliases. Map back to
            # canonical names; fall back to an explicit single plot when a
            # custom alias has platform-specific filename sanitization.
            for label in (aliases.get(layer, defaults.get(layer, layer)), layer):
                candidate = layout_dir / f"{export_board.stem}-{label.replace('.', '_')}.svg"
                if not candidate.resolve().is_relative_to(layout_dir.resolve()):
                    continue
                if batch.returncode == 0 and candidate.is_file():
                    return layer, candidate, batch
            process = _run_kicad([
                capability["path"],
                "pcb", "export", "svg",
                "--mode-single",
                "--exclude-drawing-sheet",
                "--fit-page-to-board",
                "--drill-shape-opt", "2",
                "--layers", layer,
                "--output", str(layer_file),
                str(export_board),
            ], timeout_seconds)
            if process.returncode != 0 or not layer_file.is_file():
                raise RuntimeError(f"KiCad did not create the {layer} layout SVG (exit code {process.returncode})." + _kicad_failure_details([process]))
            return layer, layer_file, process

        # Bound concurrent KiCad board loads; preserve explicit canonical layer
        # filenames even when the project has custom display aliases.
        with ThreadPoolExecutor(max_workers=2) as executor:
            exported_layers = list(executor.map(export_layer, layers))
        for layer, layer_file, process in exported_layers:
            if process is not batch:
                layout_processes.append(process)
            layer_files[layer] = str(layer_file)
            if not view_box:
                header = layer_file.read_text(encoding="utf-8", errors="replace")[:4096]
                match = re.search(r'viewBox="([^"]+)"', header)
                if match:
                    view_box = [float(value) for value in match.group(1).split()]

    if export_board != board:
        export_board.unlink(missing_ok=True)
    if model_board != board and model_board != export_board:
        model_board.unlink(missing_ok=True)
    missing_references = _missing_model_references(scene_processes)
    return {
        "contract": "spike/visual-bundle/v1",
        "status": "ready_with_warnings" if missing_references or visual_repairs else "ready",
        "offline": True,
        "source": board.name,
        "scenes": scenes,
        "layout": {
            "layers": layer_files,
            "view_box": view_box,
        },
        "generator": {
            "name": "kicad-cli",
            "executable": Path(capability["path"]).name,
            "runtime_path": capability["path"],
            "scene_exit_codes": [process.returncode for process in scene_processes],
            "layout_exit_codes": [process.returncode for process in layout_processes],
        },
        "quality": {
            **resolution,
            "visual_source_repairs": visual_repairs,
            "board_includes_copper": not lightweight_board,
            "missing_model_count": len(missing_references),
            "missing_references": missing_references,
            "model_path_substitution_count": len(model_substitutions),
            "model_path_substitutions": model_substitutions,
            "includes": [
                "board", "tracks", "pads", "zones", "inner-copper",
                "silkscreen", "soldermask", "component-models", "vector-layout",
            ],
        },
    }


def export_kicad_visual_bundle_payload(
    source_board: str,
    source_file: str,
    timeout_seconds: int = 180,
    max_artifact_bytes: int = MAX_VISUAL_BUNDLE_ARTIFACT_BYTES,
    **export_options: Any,
) -> Dict[str, Any]:
    """Export a self-contained, bounded visual bundle for desktop IPC.

    The payload path is for an already imported source document whose original
    filesystem path is unavailable to the webview. GLB is required so model
    buffers and textures cannot escape the worker-owned temporary directory.
    Project packages use their separate manifest/digest-verified artifact API.
    """

    if not isinstance(source_board, str) or not source_board.strip():
        raise ValueError("A non-empty KiCad board source is required for visual export.")
    encoded_source = source_board.encode("utf-8")
    if len(encoded_source) >= 8 * 1024 * 1024:
        export_options.setdefault("lightweight_board", True)
    if len(encoded_source) > MAX_VISUAL_BUNDLE_SOURCE_BYTES:
        raise ValueError(
            f"KiCad board source exceeds the {MAX_VISUAL_BUNDLE_SOURCE_BYTES} byte visual-export limit."
        )
    safe_name = Path(str(source_file or "imported.kicad_pcb")).name
    if not safe_name.lower().endswith(".kicad_pcb"):
        raise ValueError("Visual bundle source must use the .kicad_pcb extension.")
    if not isinstance(max_artifact_bytes, int) or isinstance(max_artifact_bytes, bool) or max_artifact_bytes <= 0:
        raise ValueError("Visual bundle artifact budget must be a positive integer.")
    budget = min(max_artifact_bytes, MAX_VISUAL_BUNDLE_ARTIFACT_BYTES)

    with tempfile.TemporaryDirectory(prefix="spike-visual-bundle-") as directory:
        root = Path(directory)
        board = root / safe_name
        board.write_bytes(encoded_source)
        exported = export_kicad_visual_bundle(
            board, root / "visuals", timeout_seconds, include_layout_layers=True, **export_options,
        )
        return _visual_bundle_payload(exported, root / "visuals", safe_name, budget)


def export_kicad_visual_bundle_path_payload(
    board_path: str | Path,
    timeout_seconds: int = 180,
    max_artifact_bytes: int = MAX_VISUAL_BUNDLE_ARTIFACT_BYTES,
    **export_options: Any,
) -> Dict[str, Any]:
    """Export an IPC payload while retaining the selected board directory.

    Native desktop selection approves ``board_path`` before this function is
    called. Keeping the original parent directory is required for KiCad's
    ``${KIPRJMOD}`` references and other project-local model assets.
    """
    board = Path(board_path).expanduser().resolve()
    if not board.is_file() or board.suffix.lower() != ".kicad_pcb":
        raise ValueError("A readable .kicad_pcb source file is required.")
    if board.stat().st_size >= 8 * 1024 * 1024:
        export_options.setdefault("lightweight_board", True)
    if not isinstance(max_artifact_bytes, int) or isinstance(max_artifact_bytes, bool) or max_artifact_bytes <= 0:
        raise ValueError("Visual bundle artifact budget must be a positive integer.")
    budget = min(max_artifact_bytes, MAX_VISUAL_BUNDLE_ARTIFACT_BYTES)
    with tempfile.TemporaryDirectory(prefix="spike-visual-bundle-") as directory:
        visual_root = Path(directory) / "visuals"
        exported = export_kicad_visual_bundle(
            board, visual_root, timeout_seconds, include_layout_layers=True, **export_options,
        )
        return _visual_bundle_payload(exported, visual_root, board.name, budget)


def _visual_bundle_payload(
    exported: Dict[str, Any],
    visual_root_value: str | Path,
    source_name: str,
    budget: int,
) -> Dict[str, Any]:
        visual_root = Path(visual_root_value).resolve()
        consumed = 0

        def artifact(path_value: Any, media_type: str) -> Dict[str, Any]:
            nonlocal consumed
            path = Path(str(path_value)).resolve()
            try:
                path.relative_to(visual_root)
            except ValueError as exc:
                raise RuntimeError("Visual export returned an artifact outside its temporary directory.") from exc
            data = path.read_bytes()
            consumed += len(data)
            if consumed > budget:
                raise RuntimeError(f"Visual bundle exceeds the {budget} byte artifact limit.")
            if media_type == "model/gltf-binary" and (path.suffix.lower() != ".glb" or not _valid_glb(path)):
                raise RuntimeError(f"Visual export returned a malformed self-contained GLB: {path.name}")
            if media_type == "model/gltf-binary":
                try:
                    external_uris = _glb_external_resource_uris(path)
                except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
                    raise RuntimeError(f"Visual export returned a malformed GLB: {path.name}: {exc}") from exc
                if external_uris:
                    raise RuntimeError(
                        f"Visual export GLB references external resources and was rejected: {path.name}"
                    )
            if media_type == "image/svg+xml" and b"<svg" not in data[:4096].lower():
                raise RuntimeError(f"Visual export returned a malformed SVG: {path.name}")
            return {
                "file_name": path.name,
                "media_type": media_type,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "artifact_base64": base64.b64encode(data).decode("ascii"),
            }

        scenes = exported.get("scenes") if isinstance(exported.get("scenes"), dict) else {}
        layout = exported.get("layout") if isinstance(exported.get("layout"), dict) else {}
        layer_paths = layout.get("layers") if isinstance(layout.get("layers"), dict) else {}
        scene_artifacts = {name: artifact(path, "model/gltf-binary") for name, path in scenes.items()}
        layers = {
            str(name): artifact(path, "image/svg+xml")
            for name, path in sorted(layer_paths.items())
        }
        return {
            "contract": "spike/visual-bundle-payload/v1",
            "status": str(exported.get("status", "ready")),
            "offline": True,
            "source": Path(source_name).name,
            "scenes": scene_artifacts,
            "layout": {"layers": layers, "view_box": list(layout.get("view_box") or [])},
            "quality": dict(exported.get("quality") or {}),
            "generator": dict(exported.get("generator") or {}),
            "artifact_bytes": consumed,
            "artifact_limit_bytes": budget,
            "security": {
                "self_contained_glb_required": True,
                "external_resource_uris_allowed": False,
                "temporary_artifacts_retained": False,
            },
        }


def build_model_manifest(components: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    entries = []
    for component in components:
        reference = component.get("reference", "U?")
        source = component.get("model_resolved") or component.get("model_path", "")
        suffix = Path(source).suffix.lower() if source else ""
        if not source:
            status = "proxy"
            message = "No model reference; use a procedural package proxy."
        elif not component.get("model_resolved"):
            status = "missing"
            message = "Model is referenced but the local asset could not be resolved."
        elif suffix in {".step", ".stp"}:
            status = "conversion_required"
            message = "STEP asset found; convert to bundled glTF for browser rendering."
        elif suffix in {".gltf", ".glb"}:
            status = "ready"
            message = "Browser-ready model asset."
        else:
            status = "unsupported"
            message = f"Unsupported model format: {suffix or 'unknown'}."
        entries.append({
            "reference": reference,
            "source": source,
            "status": status,
            "message": message,
            "at": component.get("at", [0, 0]),
            "rotation": component.get("rotation", 0),
        })
    counts = {}
    for item in entries:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    return {
        "contract": "spike/v1",
        "renderer": "webgl-gltf",
        "conversion": converter_capabilities(),
        "counts": counts,
        "components": entries,
    }
