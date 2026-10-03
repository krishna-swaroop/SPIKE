# SPDX-License-Identifier: Apache-2.0
"""Local, explicitly requested EMerge 3+ runtime update lifecycle."""

from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import threading
import time
import uuid

from .emerge_runtime_updates_io import (
    LOG_LIMIT, acquire_environment_lock, installed_metadata, newest_release,
    probe_compatibility, release_catalog, run_process, validate_python, version_key,
)


CONTRACT = "spike/emerge-runtime-update/v1"
METHODS = {"check_emerge_update", "start_emerge_update", "emerge_update_status"}
_ROOT = Path(__file__).resolve().parents[2]
_CHECK_TTL = 900
_RECOVERY = ("The environment may have changed. Check the runtime again before solving. "
             "For an incompatible installation, select or recreate a separate known-good "
             "EMerge 3+ virtual environment; automatic rollback is not available.")


class EMergeRuntimeUpdater:
    def __init__(self, project_root: Path = _ROOT):
        self.root = project_root
        self.lock = threading.RLock()
        self.operations: dict[str, dict] = {}
        self.checked: dict[tuple[str, str, str], float] = {}
        self.active: str | None = None
        self.runtime_users = 0

    def _parameters(self, params: dict) -> tuple[Path, Path, str]:
        if not isinstance(params, dict):
            raise ValueError("Update parameters must be an object.")
        channel = params.get("channel", "prerelease")
        if channel not in {"stable", "prerelease"}:
            raise ValueError("Channel must be stable or prerelease.")
        value = params.get("python_executable")
        if value is None or value == "":
            candidates = [self.root / name / folder / binary
                          for name in (".venv-emerge3", ".venv-rf", ".venv-emerge")
                          for folder, binary in (("Scripts", "python.exe"), ("bin", "python"))]
            value = next((str(item) for item in candidates if item.is_file()), None)
        if not value:
            raise ValueError("No solver virtual environment found. Select its Python executable in EMerge setup.")
        executable, root = validate_python(value)
        return executable, root, channel

    def check(self, params: dict) -> dict:
        executable, root, channel = self._parameters(params)
        with self.lock:
            if self.active or self.runtime_users:
                raise RuntimeError("Wait for the current EMerge operation to finish before checking updates.")
        current = installed_metadata(executable, root)["version"]
        target = newest_release(release_catalog(), channel)
        can_update = bool(target and (current is None or version_key(target) > version_key(current)))
        if not target:
            reason = "No non-yanked EMerge 3+ wheel release is available on this channel. Try prerelease."
        elif not can_update:
            reason = "The selected environment is already at this version or newer; downgrades are disabled."
        else:
            reason = "Update available. API compatibility is checked after installation; physics remains unvalidated."
        result = {"contract": CONTRACT, "status": "checked", "channel": channel,
                  "python_executable": str(executable), "installed_version": current,
                  "target_version": target, "can_update": can_update, "reason": reason,
                  "compatibility": None, "model_status": "unvalidated"}
        with self.lock:
            now = time.monotonic()
            self.checked = {key: stamp for key, stamp in self.checked.items() if now - stamp < _CHECK_TTL}
            if len(self.checked) >= 32:
                self.checked.pop(next(iter(self.checked)))
            if can_update:
                self.checked[(str(executable), channel, target)] = now
        return result

    def start(self, params: dict) -> dict:
        executable, root, channel = self._parameters(params)
        target = params.get("target_version")
        if version_key(target)[0] < 3:
            raise ValueError("EMerge updates require major version 3 or newer.")
        key = (str(executable), channel, target)
        with self.lock:
            if self.active or self.runtime_users:
                raise RuntimeError("An EMerge operation is already running; wait for it to finish.")
            stamp = self.checked.get(key)
            if stamp is None or time.monotonic() - stamp >= _CHECK_TTL:
                raise ValueError("Check for updates on this interpreter and channel before starting the selected version.")
            lease = acquire_environment_lock(root)
            operation_id = uuid.uuid4().hex
            state = {"contract": CONTRACT, "operation_id": operation_id, "status": "running",
                     "channel": channel, "python_executable": str(executable), "target_version": target,
                     "installed_version": None, "compatibility": None, "log": "",
                     "install_completed": False, "pip_check_passed": False,
                     "reason": "Preparing solver update.", "model_status": "unvalidated"}
            if len(self.operations) >= 16:
                self.operations.pop(next(iter(self.operations)))
            self.operations[operation_id] = state
            self.active = operation_id
            try:
                threading.Thread(target=self._update, args=(operation_id, executable, root, target, lease),
                                 daemon=False, name="emerge-runtime-update").start()
            except Exception:
                self.active = None
                del self.operations[operation_id]
                lease.close()
                raise
            return deepcopy(state)

    def status(self, params: dict) -> dict:
        operation_id = params.get("operation_id") if isinstance(params, dict) else None
        if not isinstance(operation_id, str):
            raise ValueError("An update operation_id is required.")
        with self.lock:
            if operation_id not in self.operations:
                raise ValueError("Update operation was not found in this worker. After a worker restart, "
                                 "wait until the installer process has stopped before checking the runtime "
                                 "or reopening the app; an interrupted install may require environment repair.")
            return deepcopy(self.operations[operation_id])

    def _set(self, operation_id: str, **changes) -> None:
        with self.lock:
            self.operations[operation_id].update(changes)

    def _log(self, operation_id: str, text: str) -> None:
        with self.lock:
            state = self.operations[operation_id]
            state["log"] = (state["log"] + text)[-LOG_LIMIT:]

    def _update(self, operation_id: str, executable: Path, root: Path, target: str, lease) -> None:
        try:
            current = installed_metadata(executable, root)["version"]
            self._set(operation_id, installed_version=current)
            if current and version_key(target) <= version_key(current):
                raise ValueError("Selected release is no longer newer than the installed version; update cancelled.")
            self._set(operation_id, reason="Installing the selected PyPI release.")
            command = [str(executable), "-I", "-m", "pip", "--disable-pip-version-check", "--no-input",
                       "install", "--upgrade", "--index-url", "https://pypi.org/simple",
                       "--only-binary=:all:", "--no-cache-dir", "--progress-bar", "off",
                       "--timeout", "20", "--retries", "1", "emerge==" + target]
            # Exact pins admit an alpha without allowing prereleases of unrelated dependencies.
            code, _ = run_process(command, timeout=900, on_output=lambda text: self._log(operation_id, text))
            if code:
                raise RuntimeError(f"pip install failed with exit code {code}.")
            self._set(operation_id, install_completed=True, reason="Checking installed dependencies and adapter APIs.")
            installed = installed_metadata(executable, root)["version"]
            self._set(operation_id, installed_version=installed)
            if installed != target:
                raise RuntimeError("Installed version does not match the selected release.")
            code, _ = run_process([str(executable), "-I", "-m", "pip", "--disable-pip-version-check", "check"],
                                  timeout=60, on_output=lambda text: self._log(operation_id, text))
            self._set(operation_id, pip_check_passed=code == 0)
            compatibility = probe_compatibility(executable)
            self._set(operation_id, compatibility=compatibility)
            if code:
                raise RuntimeError("Installation completed, but pip check found dependency conflicts.")
            if not compatibility.get("available"):
                raise RuntimeError("Installation completed, but adapter compatibility failed: "
                                   + str(compatibility.get("reason", "required APIs are unavailable")))
            if compatibility.get("version") != target:
                raise RuntimeError("Adapter probe version differs from the installed release; check the environment again.")
            self._set(operation_id, status="succeeded",
                      reason="Installed release passed dependency and adapter API checks. Physics remains unvalidated.")
        except Exception as error:
            self._log(operation_id, "\n" + str(error))
            try:
                self._set(operation_id, installed_version=installed_metadata(executable, root)["version"])
            except Exception:
                self._set(operation_id, installed_version=None)
            self._set(operation_id, status="failed", reason=str(error), recovery=_RECOVERY)
        finally:
            lease.close()
            with self.lock:
                self.active = None
                self.checked.clear()

    @contextmanager
    def runtime_use(self, params: dict):
        """Coordinate resident-worker extension calls with a background update."""
        shared_runtime = params.get("extension_id") in {"spike.emerge-suite", "spike.optycal-suite"}
        if shared_runtime:
            with self.lock:
                if self.active:
                    raise RuntimeError("An EMerge runtime update is running. Wait before EMerge or Optycal probing, meshing or solving.")
                self.runtime_users += 1
        try:
            yield
        finally:
            if shared_runtime:
                with self.lock:
                    self.runtime_users -= 1


updater = EMergeRuntimeUpdater()


def handle_builtin_em_with_update_guard(handler, method: str, params: dict) -> dict | None:
    """Apply the same guard to SPIKE-Em's fixed-engine execution boundary."""
    engine = params.get("engine")
    identity = f"spike.{engine}-suite" if method == "invoke_em_engine" and engine in {"emerge", "optycal"} else ""
    try:
        with updater.runtime_use({"extension_id": identity}):
            return handler(method, params)
    except RuntimeError as error:
        return {"ok": False, "error": str(error), "type": type(error).__name__}


def invoke_extension_with_update_guard(registry, params: dict) -> dict:
    """Keep the service dispatcher thin while preserving extension errors."""
    try:
        with updater.runtime_use(params):
            result = registry.invoke(str(params.get("extension_id", "")),
                                     str(params.get("contribution_id", "")), params.get("context") or {})
        return {"ok": True, "result": result}
    except (ValueError, PermissionError, RuntimeError, OSError, json.JSONDecodeError) as error:
        return {"ok": False, "error": str(error), "type": type(error).__name__}


def handle_emerge_update_request(method: str, params: dict) -> dict | None:
    if method not in METHODS:
        return None
    try:
        handler = {"check_emerge_update": updater.check, "start_emerge_update": updater.start,
                   "emerge_update_status": updater.status}[method]
        return {"ok": True, "result": handler(params)}
    except (OSError, ValueError, RuntimeError, TypeError, subprocess.SubprocessError) as error:
        return {"ok": False, "error": str(error), "type": type(error).__name__}
