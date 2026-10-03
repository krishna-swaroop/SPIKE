# SPDX-License-Identifier: Apache-2.0
"""Exercise installed desktop discovery with workers and auxiliary binaries."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.name == "nt", "Windows PowerShell path contract")
class WindowsDesktopPathTests(unittest.TestCase):
    def select(self, root):
        # Environment variables carry paths without interpolating shell code.
        environment = os.environ.copy()
        environment["SPIKE_PATH_HELPER"] = str(ROOT / "scripts/windows_desktop_path.ps1")
        environment["SPIKE_PATH_TEST_ROOT"] = str(root)
        return subprocess.run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
            "$ErrorActionPreference='Stop'; . $env:SPIKE_PATH_HELPER; "
            "Get-SpikeInstalledDesktopPath -InstallRoot $env:SPIKE_PATH_TEST_ROOT",
        ], env=environment, capture_output=True, text=True, timeout=20)

    def test_selects_root_desktop_with_auxiliary_and_nested_executables(self):
        with tempfile.TemporaryDirectory(prefix="SPIKE path with spaces ") as directory:
            root = Path(directory)
            for name in ("spike-desktop.exe", "spike-assembly-preview.exe", "uninstall.exe",
                         "bundled/spike-worker/spike-worker.exe", "tools/other.exe"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            result = self.select(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(Path(result.stdout.strip()), root / "spike-desktop.exe")

    def test_auxiliary_or_nested_desktop_cannot_substitute_for_root_entrypoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "spike-assembly-preview.exe").touch()
            (root / "nested").mkdir()
            (root / "nested/spike-desktop.exe").touch()
            result = self.select(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("installed SPIKE desktop executable is missing", result.stderr)


if __name__ == "__main__":
    unittest.main()
