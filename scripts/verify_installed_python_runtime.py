# SPDX-License-Identifier: Apache-2.0
"""Verify external-Python execution through an installed frozen SPIKE worker."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence


MAX_WORKER_RESPONSE_BYTES = 1_048_576
MAX_SCRIPT_ERROR_BYTES = 65_536
WORKER_RESPONSE_TIMEOUT_SECONDS = 45
SUCCESS_MARKER = "SPIKE_INSTALLED_RUNTIME="


class VerificationError(RuntimeError):
    """The installed worker did not satisfy its runtime contract."""


def _parse_worker_response(stdout: bytes, request_id: str) -> dict[str, Any]:
    if len(stdout) > MAX_WORKER_RESPONSE_BYTES:
        raise VerificationError("Installed worker response exceeded the 1 MB verification limit.")
    lines = [line for line in stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise VerificationError(
            f"Installed worker returned {len(lines)} nonempty protocol lines; expected exactly one."
        )
    try:
        response = json.loads(lines[0].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VerificationError("Installed worker returned malformed JSON.") from exc
    if not isinstance(response, dict):
        raise VerificationError("Installed worker response must be a JSON object.")
    if response.get("id") != request_id:
        raise VerificationError("Installed worker response ID does not match the request.")
    if not isinstance(response.get("ok"), bool):
        raise VerificationError("Installed worker response is missing its boolean ok field.")
    meta = response.get("meta")
    if not isinstance(meta, dict) or meta.get("contract") != "spike/worker-response-meta/v1":
        raise VerificationError("Installed worker response metadata contract is missing or invalid.")
    return response


def _invoke(
    worker: Path,
    installed_root: Path,
    request_id: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    request = json.dumps({
        "id": request_id,
        "method": "run_python_script",
        "params": params,
    }, ensure_ascii=False).encode("utf-8") + b"\n"
    environment = os.environ.copy()
    environment.update({
        "SPIKE_HOME": str(installed_root),
        "SPIKE_WORKSPACE": str(installed_root),
        "PYTHONNOUSERSITE": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUTF8": "1",
    })
    try:
        completed = subprocess.run(
            [str(worker)], input=request, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=installed_root, env=environment, timeout=WORKER_RESPONSE_TIMEOUT_SECONDS,
            check=False, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired as exc:
        raise VerificationError(
            f"Installed worker did not answer within {WORKER_RESPONSE_TIMEOUT_SECONDS} seconds."
        ) from exc
    if completed.returncode != 0:
        detail = completed.stderr[-8192:].decode("utf-8", errors="replace").strip()
        raise VerificationError(
            f"Installed worker exited with code {completed.returncode}: {detail or 'no diagnostic'}"
        )
    if completed.stderr.strip():
        detail = completed.stderr[-8192:].decode("utf-8", errors="replace").strip()
        raise VerificationError(f"Installed worker wrote to stderr: {detail}")
    return _parse_worker_response(completed.stdout, request_id)


def _require_result(response: dict[str, Any], label: str) -> dict[str, Any]:
    if response.get("ok") is not True:
        raise VerificationError(f"{label} was rejected by the installed worker: {response.get('error')}")
    result = response.get("result")
    if not isinstance(result, dict) or result.get("contract") != "spike/python-script-result/v1":
        raise VerificationError(f"{label} returned an invalid Python-script result contract.")
    return result


def _installed_file(value: Any, root: Path, relative: str) -> Path:
    if not isinstance(value, str):
        raise VerificationError(f"Installed runtime did not report {relative} as a path.")
    path = Path(value).resolve()
    try:
        actual_relative = path.relative_to(root)
    except ValueError as exc:
        raise VerificationError(f"Imported module escaped the installed root: {path}") from exc
    if actual_relative.as_posix() != relative or not path.is_file():
        raise VerificationError(
            f"Imported module resolved to {actual_relative.as_posix()!r}; expected {relative!r}."
        )
    return path


def verify(installed_root: Path, worker: Path, python_executable: Path) -> dict[str, Any]:
    if not installed_root.is_absolute() or not worker.is_absolute() or not python_executable.is_absolute():
        raise VerificationError("Installed root, worker, and external Python must be absolute paths.")
    installed_root = installed_root.resolve()
    worker = worker.resolve()
    python_executable = python_executable.resolve()
    if not installed_root.is_dir():
        raise VerificationError(f"Installed root is not a directory: {installed_root}")
    if not worker.is_file():
        raise VerificationError(f"Installed frozen worker is missing: {worker}")
    try:
        worker.relative_to(installed_root)
    except ValueError as exc:
        raise VerificationError("Frozen worker must be inside the installed root.") from exc
    if not python_executable.is_file():
        raise VerificationError(f"External Python executable is missing: {python_executable}")

    success_code = """\
import json
from pathlib import Path
from extension_sdk.python import spike_extension_sdk
from extensions.emerge_suite import normalize

print(%r + json.dumps({
    "sdk_file": str(Path(spike_extension_sdk.__file__).resolve()),
    "extension_file": str(Path(normalize.__file__).resolve()),
    "sdk_contract": spike_extension_sdk.analysis_envelope(
        {"contract": "spike/v1"}, title="Installed runtime probe")["contract"],
    "extension_value": normalize._number(2, "value"),
}, sort_keys=True))
""" % SUCCESS_MARKER
    success = _require_result(_invoke(
        worker, installed_root, "installed-python-imports",
        {"python_executable": str(python_executable), "code": success_code, "timeout_seconds": 15},
    ), "Installed external-Python import probe")
    if success.get("status") != "completed" or success.get("return_code") != 0:
        raise VerificationError(f"Installed external-Python import probe failed: {success.get('stderr')}")
    marker_lines = [line for line in str(success.get("stdout", "")).splitlines()
                    if line.startswith(SUCCESS_MARKER)]
    if len(marker_lines) != 1:
        raise VerificationError("Installed import probe did not return its single evidence record.")
    try:
        evidence = json.loads(marker_lines[0][len(SUCCESS_MARKER):])
    except json.JSONDecodeError as exc:
        raise VerificationError("Installed import probe returned malformed evidence JSON.") from exc
    if evidence.get("sdk_contract") != "spike/extension-result/v1" or evidence.get("extension_value") != 2.0:
        raise VerificationError("Installed SDK or bundled extension behavior differs from its contract.")
    _installed_file(evidence.get("sdk_file"), installed_root,
                    "extension_sdk/python/spike_extension_sdk.py")
    _installed_file(evidence.get("extension_file"), installed_root,
                    "extensions/emerge_suite/normalize.py")

    failure = _require_result(_invoke(
        worker, installed_root, "installed-python-error",
        {"python_executable": str(python_executable),
         "code": "raise RuntimeError('installed-runtime-error-probe')", "timeout_seconds": 15},
    ), "Installed external-Python error probe")
    failure_text = str(failure.get("stderr", ""))
    if failure.get("status") != "failed" or "installed-runtime-error-probe" not in failure_text:
        raise VerificationError("Installed runtime did not return the expected bounded script error.")
    if len(failure_text.encode("utf-8")) > MAX_SCRIPT_ERROR_BYTES:
        raise VerificationError("Installed runtime script error exceeded the 64 KB verification limit.")

    timeout = _require_result(_invoke(
        worker, installed_root, "installed-python-timeout",
        {"python_executable": str(python_executable), "code": "while True: pass",
         "timeout_seconds": 1},
    ), "Installed external-Python timeout probe")
    if (timeout.get("status") != "failed"
            or "exceeded the 1-second limit" not in str(timeout.get("stderr", ""))):
        raise VerificationError("Installed runtime did not enforce the one-second script timeout.")

    return {
        "contract": "spike/installed-python-runtime-verification/v1",
        "status": "passed",
        "installed_root": str(installed_root),
        "worker": str(worker),
        "python_executable": str(python_executable),
        "probes": ["installed_import_paths", "bounded_script_error", "script_timeout"],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installed-root", required=True, type=Path)
    parser.add_argument("--worker", required=True, type=Path)
    parser.add_argument("--python-executable", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report = verify(args.installed_root, args.worker, args.python_executable)
    except (OSError, ValueError, VerificationError) as exc:
        print(f"installed Python runtime verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
