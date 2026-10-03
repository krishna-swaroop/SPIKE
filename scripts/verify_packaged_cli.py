"""Verify an installed Linux or macOS SPIKE launcher against the source CLI."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SOURCE_COMMAND = [sys.executable, str(ROOT / "scripts" / "spike_worker_entry.py"), "--cli"]


def _run(command: Sequence[str], arguments: Sequence[str]) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update({"COLUMNS": "120", "PYTHONUTF8": "1"})
    return subprocess.run(
        [*command, *arguments], cwd=ROOT, env=environment, text=True,
        capture_output=True, timeout=120, check=False,
    )


def _require_success(result: subprocess.CompletedProcess[str], label: str) -> None:
    if result.returncode != 0:
        raise RuntimeError(
            f"{label} failed with exit code {result.returncode}: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )


def _normalized_help(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.replace("\r\n", "\n").strip().splitlines())


def _source_help_surface() -> dict[str, str]:
    # Import only when verification runs so --help for this verifier remains usable
    # in a host environment that has not installed SPIKE's runtime dependencies.
    from python.spike_core.cli import build_parser

    parser = build_parser()
    subparsers = next(
        action for action in parser._actions
        if isinstance(action, argparse._SubParsersAction)
    )
    return {
        "<root>": parser.format_help(),
        **{name: command_parser.format_help() for name, command_parser in subparsers.choices.items()},
    }


def verify(command: Sequence[str]) -> dict[str, object]:
    if not command:
        raise ValueError("An installed launcher command is required after --.")

    os.environ["COLUMNS"] = "120"
    source_help = _source_help_surface()
    checked_help: list[str] = []
    for name, expected in source_help.items():
        arguments = ["--help"] if name == "<root>" else [name, "--help"]
        actual = _run(command, arguments)
        _require_success(actual, f"packaged help for {name}")
        if actual.stderr:
            raise RuntimeError(f"Packaged help for {name} wrote to stderr: {actual.stderr.strip()}")
        if _normalized_help(actual.stdout) != _normalized_help(expected):
            raise RuntimeError(f"Packaged help differs from the source parser for {name}.")
        checked_help.append(name)

    source_version = _run(SOURCE_COMMAND, ["--version"])
    packaged_version = _run(command, ["--version"])
    _require_success(source_version, "source version")
    _require_success(packaged_version, "packaged version")
    if packaged_version.stdout.strip() != source_version.stdout.strip():
        raise RuntimeError(
            "Packaged version differs from source: "
            f"{packaged_version.stdout.strip()!r} != {source_version.stdout.strip()!r}"
        )

    home = Path.home()
    with tempfile.TemporaryDirectory(prefix="spike-packaged-cli-", dir=home) as directory:
        fixture = Path(directory) / "inspect-fixture.json"
        fixture.write_text(json.dumps({
            "contract": "spike/v1",
            "design_id": "packaged-cli-verifier",
            "name": "packaged CLI verifier",
            "source_format": "fixture",
            "source_path": str(fixture),
            "units": "mm",
            "layers": [{"name": "F.Cu"}],
            "nets": [{"id": 1, "name": "VCC"}],
            "tracks": [{
                "start": [0, 0], "end": [10, 0], "width": 1,
                "layer": "F.Cu", "net_name": "VCC",
            }],
            "vias": [],
            "pads": [],
            "zones": [],
            "components": [],
            "stackup": [{"name": "F.Cu", "type": "copper", "thickness": 0.035}],
            "metadata": {},
        }), encoding="utf-8")

        inspect_arguments = ["--compact", "inspect", str(fixture)]
        source_inspect = _run(SOURCE_COMMAND, inspect_arguments)
        packaged_inspect = _run(command, inspect_arguments)
        _require_success(source_inspect, "source inspect")
        _require_success(packaged_inspect, "packaged inspect")
        if json.loads(packaged_inspect.stdout) != json.loads(source_inspect.stdout):
            raise RuntimeError("Packaged inspect output differs from source output.")

        missing = Path(directory) / "missing.json"
        source_error = _run(SOURCE_COMMAND, ["inspect", str(missing)])
        packaged_error = _run(command, ["inspect", str(missing)])
        if packaged_error.returncode != source_error.returncode or packaged_error.returncode == 0:
            raise RuntimeError(
                "Packaged structured-error exit code differs from source: "
                f"{packaged_error.returncode} != {source_error.returncode}."
            )
        expected_error = json.loads(source_error.stdout)
        actual_error = json.loads(packaged_error.stdout)
        if actual_error != expected_error or actual_error.get("ok") is not False:
            raise RuntimeError("Packaged structured error differs from source output.")
        if packaged_error.stderr:
            raise RuntimeError(
                "Packaged operational error wrote to stderr: "
                f"{packaged_error.stderr.strip()}"
            )

    return {
        "contract": "spike/packaged-cli-verification/v1",
        "status": "passed",
        "launcher": list(command),
        "version": packaged_version.stdout.strip(),
        "help_surfaces": len(checked_help),
        "commands": [name for name in checked_help if name != "<root>"],
        "probes": ["help", "version", "inspect", "structured_error"],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify an installed SPIKE launcher that already enters CLI mode.",
        usage="%(prog)s -- LAUNCHER [LAUNCHER_ARG ...]",
    )
    parser.add_argument("launcher", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    launcher = args.launcher[1:] if args.launcher[:1] == ["--"] else args.launcher
    if not launcher:
        parser.error("an installed launcher command is required after --")
    try:
        report = verify(launcher)
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"packaged CLI verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
