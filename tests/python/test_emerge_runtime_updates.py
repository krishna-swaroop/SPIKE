# SPDX-License-Identifier: Apache-2.0
"""Runtime-update regressions: no network access, package installation or GUI."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

from python.spike_core import emerge_runtime_updates as updates
from python.spike_core import emerge_runtime_updates_io as boundary


WHEEL = [{"packagetype": "bdist_wheel", "yanked": False}]
RELEASES = {"2.8.9": WHEEL, "3.0.0a19": WHEEL, "3.0.0a20": WHEEL}


class EMergeRuntimeUpdateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.venv = self.root / ".venv-emerge3"
        self.python = self.venv / "Scripts" / "python.exe"
        self.python.parent.mkdir(parents=True)
        self.python.write_bytes(b"test executable - never executed")
        (self.venv / "pyvenv.cfg").write_text("include-system-site-packages = false\n")
        self.manager = updates.EMergeRuntimeUpdater(self.root)
        self.params = {"python_executable": str(self.python), "channel": "prerelease"}
        self.current = "3.0.0a19"
        self.meta = patch.object(updates, "installed_metadata", side_effect=lambda *args: {"version": self.current}).start()
        self.catalog = patch.object(updates, "release_catalog", return_value=RELEASES).start()
        self.addCleanup(patch.stopall)

    def checked(self):
        result = self.manager.check(self.params)
        self.assertTrue(result["can_update"])
        return {**self.params, "target_version": result["target_version"]}

    def run_update(self, *, install_code=0, check_code=0, compatibility=None, failure=None):
        self.done = threading.Event()
        original = self.manager._update

        def work(*args):
            try:
                original(*args)
            finally:
                self.done.set()

        def run(command, **kwargs):
            if "install" in command:
                if failure:
                    raise failure
                if not install_code:
                    self.current = "3.0.0a20"
                kwargs["on_output"]("test install output\n")
                return install_code, ""
            return check_code, ""

        self.process = patch.object(updates, "run_process", side_effect=run).start()
        self.probe = patch.object(updates, "probe_compatibility", return_value=compatibility or {
            "available": True, "version": "3.0.0a20", "adapter_evidence": "api_detected"}).start()
        with patch.object(self.manager, "_update", side_effect=work):
            start = self.manager.start(self.checked())
        self.assertTrue(self.done.wait(5), "update worker did not finish")
        return self.manager.status({"operation_id": start["operation_id"]})

    def test_check_selects_latest_alpha_and_stable_never_downgrades_to_two(self):
        result = self.manager.check(self.params)
        self.assertEqual(result["target_version"], "3.0.0a20")
        stable = self.manager.check({**self.params, "channel": "stable"})
        self.assertFalse(stable["can_update"])
        self.assertIsNone(stable["target_version"])
        self.current = "4.0.0"
        self.assertFalse(self.manager.check(self.params)["can_update"])

    def test_success_pins_pypi_and_checks_dependency_and_api_status(self):
        result = self.run_update()
        self.assertEqual(result["status"], "succeeded")
        self.assertTrue(result["install_completed"])
        self.assertTrue(result["pip_check_passed"])
        self.assertEqual(result["installed_version"], "3.0.0a20")
        self.assertEqual(result["model_status"], "unvalidated")
        command = self.process.call_args_list[0].args[0]
        self.assertEqual(command[-1], "emerge==3.0.0a20")
        self.assertEqual(command[command.index("--index-url") + 1], "https://pypi.org/simple")
        self.assertIn("--only-binary=:all:", command)
        self.assertNotIn("--pre", command)
        self.probe.assert_called_once_with(self.python)

    def test_invalid_versions_paths_and_unchecked_targets_cannot_start(self):
        for value in ("2.8.9", "https://host/emerge.whl", "3.0.0;cmd", "3.0.0 --extra-index-url evil", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.manager.start({**self.params, "target_version": value})
        with self.assertRaises(ValueError):
            self.manager.start({**self.params, "target_version": "3.0.0a20"})
        for value in ("python", str(self.root / "absent.exe"), str(self.root)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.manager.check({"python_executable": value})
        with patch.object(boundary.sys, "executable", str(self.python)), self.assertRaises(ValueError):
            self.manager.check(self.params)
        (self.venv / "pyvenv.cfg").write_text("include-system-site-packages = true\n")
        with self.assertRaises(ValueError):
            self.manager.check(self.params)

    def test_install_failure_and_timeout_release_lock_for_retry(self):
        for kwargs in ({"install_code": 1}, {"failure": subprocess.TimeoutExpired("pip", 900)}):
            with self.subTest(kwargs=kwargs):
                result = self.run_update(**kwargs)
                self.assertEqual(result["status"], "failed")
                self.assertFalse(result["install_completed"])
                self.assertIn("automatic rollback", result["recovery"])
                self.assertIsNone(self.manager.active)
                lease = boundary.acquire_environment_lock(self.venv)
                lease.close()

    def test_post_install_api_failure_does_not_claim_success(self):
        result = self.run_update(compatibility={"available": False, "reason": "missing microwave_sweep"})
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["install_completed"])
        self.assertEqual(result["installed_version"], "3.0.0a20")
        self.assertIn("missing microwave_sweep", result["reason"])

    def test_dependency_failure_still_reports_api_probe(self):
        result = self.run_update(check_code=1)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["pip_check_passed"])
        self.assertTrue(result["compatibility"]["available"])

    def test_concurrent_updates_and_solver_calls_are_rejected(self):
        target = self.checked()
        with patch.object(updates.threading, "Thread") as thread:
            result = self.manager.start(target)
        self.addCleanup(thread.call_args.kwargs["args"][-1].close)
        with self.assertRaises(RuntimeError):
            self.manager.start(target)
        with self.assertRaises(RuntimeError):
            with self.manager.runtime_use({"extension_id": "spike.emerge-suite"}):
                pass
        self.assertEqual(self.manager.status({"operation_id": result["operation_id"]})["status"], "running")

    def test_solver_guard_prevents_start_and_releases_on_failure(self):
        target = self.checked()
        with self.manager.runtime_use({"extension_id": "spike.emerge-suite"}):
            with self.assertRaises(RuntimeError):
                self.manager.start(target)
        self.assertEqual(self.manager.runtime_users, 0)

    def test_optycal_guard_prevents_update_and_releases_after_failure(self):
        target = self.checked()
        with self.assertRaisesRegex(RuntimeError, "Optycal solve failed"):
            with self.manager.runtime_use({"extension_id": "spike.optycal-suite"}):
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    self.manager.start(target)
                raise RuntimeError("Optycal solve failed")
        self.assertEqual(self.manager.runtime_users, 0)

    def test_update_blocks_optycal_dispatch_but_allows_unrelated_extensions(self):
        from python.spike_core import service
        self.manager.active = "running"
        with patch.object(updates, "updater", self.manager):
            with patch.object(service._extension_registry, "invoke", return_value={"status": "completed"}) as invoke:
                denied = service.handle({"method": "invoke_extension", "params": {
                    "extension_id": "spike.optycal-suite", "contribution_id": "optycal-probe"}})
                self.assertFalse(denied["ok"])
                invoke.assert_not_called()
                allowed = service.handle({"method": "invoke_extension", "params": {
                    "extension_id": "other.example", "contribution_id": "probe"}})
                self.assertTrue(allowed["ok"])
                invoke.assert_called_once_with("other.example", "probe", {})
            if hasattr(service, "handle_em_request"):
                with patch.object(service, "handle_em_request") as engine:
                    denied = service.handle({"method": "invoke_em_engine", "params": {
                        "engine": "optycal", "contribution_id": "optycal-radiation"}})
                self.assertFalse(denied["ok"])
                engine.assert_not_called()

    def test_recheck_current_version_prevents_stale_downgrade(self):
        target = self.checked()
        self.current = "3.0.0"
        with patch.object(updates, "run_process") as process, patch.object(updates.threading, "Thread") as thread:
            self.manager.start(target)
            self.manager._update(*thread.call_args.kwargs["args"])
        process.assert_not_called()
        self.assertEqual(next(iter(self.manager.operations.values()))["status"], "failed")

    def test_log_retention_and_status_are_bounded_copies(self):
        self.manager.operations["test"] = {"log": "", "compatibility": {"available": True}}
        self.manager._log("test", "x" * (boundary.LOG_LIMIT + 1000))
        state = self.manager.status({"operation_id": "test"})
        self.assertEqual(len(state["log"]), boundary.LOG_LIMIT)
        state["compatibility"]["available"] = False
        self.assertTrue(self.manager.operations["test"]["compatibility"]["available"])

    def test_actual_worker_routes_and_update_blocks_extension_dispatch(self):
        from python.spike_core import service
        with patch.object(updates, "updater", self.manager):
            result = service.handle({"method": "check_emerge_update", "params": self.params})
            self.assertTrue(result["ok"])
            self.assertEqual(result["result"]["contract"], updates.CONTRACT)
            self.assertFalse(service.handle({"method": "start_emerge_update", "params": {}})["ok"])
            self.assertFalse(service.handle({"method": "emerge_update_status", "params": {"operation_id": "unknown"}})["ok"])
            self.manager.active = "running"
            with patch.object(service._extension_registry, "invoke") as invoke:
                denied = service.handle({"method": "invoke_extension", "params": {
                    "extension_id": "spike.emerge-suite", "contribution_id": "emerge-si"}})
            self.assertFalse(denied["ok"])
            invoke.assert_not_called()
            if hasattr(service, "handle_em_request"):
                with patch.object(service, "handle_em_request") as engine:
                    denied = service.handle({"method": "invoke_em_engine", "params": {
                        "engine": "emerge", "contribution_id": "emerge-si"}})
                self.assertFalse(denied["ok"])
                engine.assert_not_called()

    def test_environment_lock_rejects_other_updater(self):
        lease = boundary.acquire_environment_lock(self.venv)
        try:
            with self.assertRaises(RuntimeError):
                boundary.acquire_environment_lock(self.venv)
        finally:
            lease.close()


class RuntimeBoundaryTests(unittest.TestCase):
    def test_supported_release_order_yanks_and_stable_filter(self):
        versions = ["3.0.0.dev1", "3.0.0a19", "3.0.0a20", "3.0.0b1", "3.0.0rc1", "3.0.0", "3.0.0.post1", "3.1.0"]
        self.assertEqual(sorted(reversed(versions), key=boundary.version_key), versions)
        releases = {**RELEASES, "3.0.0": WHEEL, "4.0.0": [{"packagetype": "bdist_wheel", "yanked": True}]}
        self.assertEqual(boundary.newest_release(releases, "stable"), "3.0.0")

    def test_clean_environment_removes_all_pip_and_python_injection(self):
        with patch.dict(os.environ, {"PIP_EXTRA_INDEX_URL": "https://evil", "PIP_TARGET": "elsewhere",
                                     "PIP_CONFIG_FILE": "evil.ini", "PYTHONPATH": "evil", "HTTP_PROXY": "evil"}):
            result = boundary.clean_environment()
        self.assertEqual(result["PIP_CONFIG_FILE"], os.devnull)
        self.assertEqual(result["PIP_REQUIRE_VIRTUALENV"], "true")
        for name in ("PIP_EXTRA_INDEX_URL", "PIP_TARGET", "PYTHONPATH", "HTTP_PROXY"):
            self.assertNotIn(name, result)

    def test_process_stream_is_bounded_and_timeout_kills(self):
        process = MagicMock()
        process.stdout = io.BytesIO(b"x" * 100000)
        process.wait.return_value = 0
        with patch.object(boundary.subprocess, "Popen", return_value=process) as popen:
            code, text = boundary.run_process(["fake", "-I"], timeout=1)
        self.assertEqual(code, 0)
        self.assertLessEqual(len(text), boundary.LOG_LIMIT)
        self.assertFalse(popen.call_args.kwargs["shell"])
        process.stdout = io.BytesIO(b"timeout")
        process.wait.side_effect = [subprocess.TimeoutExpired("fake", 1), 0]
        with patch.object(boundary.subprocess, "Popen", return_value=process), self.assertRaises(subprocess.TimeoutExpired):
            boundary.run_process(["fake"], timeout=1)
        process.kill.assert_called_once()

    def test_metadata_requires_real_venv_identity(self):
        data = {"prefix": str(Path.cwd()), "base_prefix": str(Path.cwd()), "version": "3.0.0"}
        with patch.object(boundary, "run_process", return_value=(0, json.dumps(data))), self.assertRaises(ValueError):
            boundary.installed_metadata(Path(sys.executable), Path.cwd())

    def test_catalog_bounds_and_redirects(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = b"x" * (4 * 1024 * 1024 + 1)
        with patch.object(boundary.urllib.request, "build_opener", return_value=opener), self.assertRaises(ValueError):
            boundary.release_catalog()
        with self.assertRaises(ValueError):
            boundary._NoRedirect().redirect_request(None, None, 302, "redirect", {}, "http://evil")


if __name__ == "__main__":
    unittest.main()
