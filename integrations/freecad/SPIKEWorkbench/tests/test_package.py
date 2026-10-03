# SPDX-License-Identifier: MIT
"""Standalone ZIPs must not depend on the SPIKE parent checkout."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("spike_package", ROOT / "tools" / "package.py")
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)


class PackageTests(unittest.TestCase):
    def test_install_and_source_archives_are_complete_and_reproducible(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            install_a = root / "install-a.zip"
            install_b = root / "install-b.zip"
            source = root / "source.zip"
            _, digest_a = PACKAGE.build("install", install_a)
            _, digest_b = PACKAGE.build("install", install_b)
            PACKAGE.build("source", source)
            self.assertEqual(digest_a, digest_b)
            with ZipFile(install_a) as archive:
                names = set(archive.namelist())
                self.assertIn("SPIKEWorkbench/package.xml", names)
                self.assertIn("SPIKEWorkbench/docs/USER_GUIDE.md", names)
                self.assertIn("SPIKEWorkbench/spike_freecad/help_view.py", names)
                self.assertNotIn("SPIKEWorkbench/.github/workflows/ci.yml", names)
                self.assertFalse(any("__pycache__" in name or name.endswith(".pyc") for name in names))
            with ZipFile(source) as archive:
                names = set(archive.namelist())
                self.assertIn("SPIKEWorkbench/.github/workflows/ci.yml", names)
                self.assertIn("SPIKEWorkbench/tools/package.py", names)
                self.assertIn("SPIKEWorkbench/tests/test_package.py", names)


if __name__ == "__main__":
    unittest.main()
