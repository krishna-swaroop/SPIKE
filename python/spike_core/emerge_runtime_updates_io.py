# SPDX-License-Identifier: Apache-2.0
"""Bounded process, environment and PyPI boundaries for EMerge maintenance."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import urllib.request


LOG_LIMIT = 24000
_VERSION = re.compile(r"(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:(a|b|rc)(\d{1,6}))?(?:\.post(\d{1,6}))?(?:\.dev(\d{1,6}))?\Z")


def version_key(value: str) -> tuple:
    """Order admitted public releases; reject URLs, ranges, local/epoch versions."""
    match = _VERSION.fullmatch(value) if isinstance(value, str) and len(value) <= 64 else None
    if not match:
        raise ValueError("Expected a public EMerge release version, for example 3.0.0a20.")
    major, minor, patch, stage, number, post, dev = match.groups()
    phase = {"a": 0, "b": 1, "rc": 2}.get(stage, -1 if dev and not post else 3)
    return (int(major), int(minor), int(patch or 0), phase, int(number or 0),
            int(post) if post else -1, int(dev) if dev else float("inf"))


def clean_environment() -> dict[str, str]:
    allowed = {"SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "PATH", "TEMP", "TMP",
               "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL"}
    result = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    result.update(PIP_CONFIG_FILE=os.devnull, PIP_REQUIRE_VIRTUALENV="true",
                  PYTHONIOENCODING="utf-8")
    return result


def run_process(command: list[str], *, timeout: float, on_output=None) -> tuple[int, str]:
    """Drain incrementally, retain only a bounded tail, kill/reap on timeout."""
    output = bytearray()
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, shell=False, env=clean_environment(),
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def drain() -> None:
        assert process.stdout is not None
        while chunk := process.stdout.read(4096):
            output.extend(chunk)
            del output[:-LOG_LIMIT]
            if on_output:
                on_output(chunk.decode("utf-8", errors="replace"))

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    try:
        code = process.wait(timeout=timeout)
    except BaseException:
        process.kill()
        process.wait(timeout=10)
        raise
    finally:
        reader.join(timeout=5)
        if not reader.is_alive() and process.stdout:
            process.stdout.close()
    return code, output.decode("utf-8", errors="replace")


def validate_python(value: str) -> tuple[Path, Path]:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Select an absolute Python executable in a solver virtual environment.")
    executable = Path(value).expanduser()
    if not executable.is_absolute() or not executable.is_file():
        raise ValueError("Solver Python must be an existing absolute executable path.")
    # Keep a POSIX venv's python symlink: resolving it loses the venv identity.
    root = executable.parent.parent.resolve()
    if (executable.parent.name.lower() not in {"scripts", "bin"}
            or not re.fullmatch(r"python(?:3(?:\.\d+)?)?(?:\.exe)?", executable.name.lower())
            or not (root / "pyvenv.cfg").is_file()):
        raise ValueError("Updates require a dedicated Python virtual environment (pyvenv.cfg).")
    if (os.path.normcase(os.path.abspath(executable)) == os.path.normcase(os.path.abspath(sys.executable))
            or root == Path(sys.prefix).resolve()):
        raise ValueError("The running worker interpreter cannot be updated. Select a separate solver environment.")
    config = (root / "pyvenv.cfg").read_text(encoding="utf-8")
    if re.search(r"(?im)^include-system-site-packages\s*=\s*true\s*$", config):
        raise ValueError("Use an isolated solver virtual environment without system site packages.")
    return executable, root


_METADATA = """
import json, sys
from importlib.metadata import version, PackageNotFoundError
try:
    installed = version('emerge')
except PackageNotFoundError:
    installed = None
print(json.dumps({'prefix': sys.prefix, 'base_prefix': sys.base_prefix, 'version': installed}))
"""


def installed_metadata(executable: Path, root: Path) -> dict:
    code, output = run_process([str(executable), "-I", "-c", _METADATA], timeout=15)
    if code:
        raise RuntimeError("Cannot inspect solver Python: " + output[-1500:])
    try:
        data = json.loads(output.splitlines()[-1])
        prefix, base = Path(data["prefix"]).resolve(), Path(data["base_prefix"]).resolve()
        if prefix != root or prefix == base:
            raise ValueError("Interpreter did not confirm the selected virtual environment.")
        if data["version"] is not None:
            version_key(data["version"])
        return data
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise ValueError("Invalid solver environment metadata: " + str(error)) from error


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("PyPI metadata redirects are not allowed.")


def release_catalog() -> dict:
    request = urllib.request.Request("https://pypi.org/pypi/emerge/json",
                                     headers={"Accept": "application/json", "User-Agent": "SPIKE-runtime-updater/1"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    with opener.open(request, timeout=15) as response:
        payload = response.read(4 * 1024 * 1024 + 1)
    if len(payload) > 4 * 1024 * 1024:
        raise ValueError("PyPI metadata exceeds the 4 MiB limit.")
    data = json.loads(payload)
    if not isinstance(data, dict) or not isinstance(data.get("releases"), dict):
        raise ValueError("PyPI returned invalid release metadata.")
    return data["releases"]


def newest_release(releases: dict, channel: str) -> str | None:
    candidates = []
    for version, files in releases.items():
        try:
            key = version_key(version)
        except ValueError:
            continue
        if key[0] < 3 or (channel == "stable" and (key[3] != 3 or key[6] != float("inf"))):
            continue
        if isinstance(files, list) and any(isinstance(item, dict) and not item.get("yanked", False)
                                          and item.get("packagetype") == "bdist_wheel" for item in files):
            candidates.append((key, version))
    return max(candidates)[1] if candidates else None


def acquire_environment_lock(root: Path):
    """OS-owned advisory lock automatically released after a worker crash."""
    stream = (root / ".spike-emerge-update.lock").open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            if stream.seek(0, 2) == 0:
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        stream.close()
        raise RuntimeError("Another SPIKE process is updating this solver environment.") from error
    return stream


def probe_compatibility(executable: Path) -> dict:
    # Reuse the adapter's authoritative API checks, each in a fresh subprocess.
    from extensions.emerge_suite.extension import _probe_executable
    return _probe_executable(executable)
