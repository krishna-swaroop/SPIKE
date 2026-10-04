# SPDX-License-Identifier: Apache-2.0
"""Stage current release source and generated workers without local caches."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys


def source_files(root: Path) -> set[str]:
    snapshot = root / "RELEASE_SOURCE_MANIFEST.json"
    if snapshot.is_file():
        return {entry["path"] for entry in json.loads(snapshot.read_text(encoding="utf-8"))["files"]}
    output = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root,
    )
    return set(output.decode("utf-8").split("\0")) - {""}


def prepare(root: Path, output: Path | None = None) -> Path:
    root = root.resolve()
    included = source_files(root)
    config_path = root / "app/src-tauri/tauri.conf.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    stage = (root / "build/release-resources").resolve()
    if stage.parent != (root / "build").resolve():
        raise RuntimeError("Refusing to reset an unmanaged resource directory")
    sources = [(str(src), (config_path.parent / src).resolve(), str(dst)) for src, dst in config["bundle"]["resources"].items()]
    if any(source == stage for _, source, _ in sources):
        raise RuntimeError("Use the original Tauri configuration when staging resources")
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for _, source, dst in sources:
        source.relative_to(root)
        if source == root / "app/src-tauri/resources/worker":
            shutil.copytree(source, stage / dst, symlinks=True, dirs_exist_ok=True)
            continue
        files = source.rglob("*") if source.is_dir() else [source]
        for file in files:
            if not file.is_file() or "__pycache__" in file.parts or file.suffix in {".pyc", ".pyo"}:
                continue
            if file.relative_to(root).as_posix() not in included:
                continue
            target = stage / dst / file.relative_to(source) if source.is_dir() else stage / dst
            target.resolve().relative_to(stage)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
    config["bundle"]["resources"] = {"../../build/release-resources/": "./"}
    if sys.platform == "win32":
        name = "spike-em" if config["identifier"] == "org.spike.em" else "spike"
        (stage / f"{name}.cmd").write_text(
            '@echo off\nset "SPIKE_HOME=%~dp0"\nset "SPIKE_WORKSPACE=%~dp0"\n'
            '"%~dp0bundled\\spike-worker\\spike-worker.exe" --cli %*\nexit /b %errorlevel%\n', encoding="utf-8",
        )
    if sys.platform == "darwin":
        config["bundle"]["macOS"] = {"minimumSystemVersion": "15.0", "signingIdentity": "-"}
    destination = output or config_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-output", type=Path, help="Preserve source config and emit a build config here")
    args = parser.parse_args()
    print(prepare(Path(__file__).resolve().parents[1], args.config_output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
