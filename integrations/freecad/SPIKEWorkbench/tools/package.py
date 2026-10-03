# SPDX-License-Identifier: MIT
"""Build deterministic installation or standalone-source ZIPs from this root."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
INSTALL_FILES = (
    "Init.py", "InitGui.py", "package.xml", "LICENSE", "README.md",
    "GIT_WORKFLOW.md", "THIRD_PARTY_NOTICES.md",
)
INSTALL_DIRS = ("Resources", "docs", "examples", "spike_freecad")
SOURCE_FILES = (".gitignore", ".gitattributes", "CONTRIBUTING.md", "SECURITY.md",
                "RELEASE_CHECKLIST.md")
SOURCE_DIRS = (".github", "tests", "tools")
SUFFIXES = {".py", ".json", ".svg", ".xml", ".md", ".jpg", ".png", ".yml", ".yaml"}


def package_files(kind: str) -> list[Path]:
    """Use an explicit root manifest; omit caches, binaries, and local outputs."""
    if kind not in {"install", "source"}:
        raise ValueError("kind must be install or source")
    files = INSTALL_FILES + (SOURCE_FILES if kind == "source" else ())
    directories = INSTALL_DIRS + (SOURCE_DIRS if kind == "source" else ())
    selected = []
    for name in files:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Required release file is absent or linked: {name}")
        selected.append(path)
    for name in directories:
        directory = ROOT / name
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError(f"Required release directory is absent or linked: {name}")
        for path in directory.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"Release tree contains a link: {path.relative_to(ROOT)}")
            if not path.is_file():
                continue
            if "__pycache__" in path.parts or path.suffix in {".pyc", ".pyo"}:
                continue
            if path.suffix.lower() not in SUFFIXES:
                raise ValueError(f"Review unexpected release file: {path.relative_to(ROOT)}")
            selected.append(path)
    return sorted(selected, key=lambda path: path.relative_to(ROOT).as_posix())


def build(kind: str, output: Path) -> tuple[int, str]:
    if output.exists():
        raise ValueError("Output already exists; choose a new ZIP path.")
    version = ET.parse(ROOT / "package.xml").getroot().findtext("{*}version")
    if not version:
        raise ValueError("package.xml has no version")
    files = package_files(kind)
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "x", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            relative = path.relative_to(ROOT).as_posix()
            entry = ZipInfo("SPIKEWorkbench/" + relative, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED,
                             compresslevel=9)
    with ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP integrity check failed")
    return len(files), hashlib.sha256(output.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("install", "source"), default="install")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    count, digest = build(args.kind, args.output.resolve())
    print(f"{args.output.resolve()}\n{count} files; SHA-256 {digest}")


if __name__ == "__main__":
    main()
