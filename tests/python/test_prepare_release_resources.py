# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.prepare_release_resources import prepare, source_files


class PrepareReleaseResourcesTests(unittest.TestCase):
    def test_current_unignored_source_and_worker_are_staged_without_mutating_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "app/src-tauri/tauri.conf.json"
            source = root / "python"
            worker = root / "app/src-tauri/resources/worker"
            source.mkdir(parents=True); worker.mkdir(parents=True); config_path.parent.mkdir(parents=True, exist_ok=True)
            (source / "tracked.py").write_text("tracked\n", encoding="utf-8")
            (source / "new.py").write_text("new\n", encoding="utf-8")
            (source / "ignored.py").write_text("ignored\n", encoding="utf-8")
            (worker / "spike-worker.exe").write_bytes(b"worker")
            (root / ".gitignore").write_text("python/ignored.py\n", encoding="utf-8")
            original = {"identifier": "org.spike.desktop", "bundle": {"resources": {"../../python": "python", "resources/worker": "bundled/spike-worker"}}}
            config_text = json.dumps(original, indent=2) + "\n"; config_path.write_text(config_text, encoding="utf-8")
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "add", ".gitignore", "python/tracked.py", "app/src-tauri/tauri.conf.json"], cwd=root, check=True)
            stale = root / "build/release-resources/stale.txt"; stale.parent.mkdir(parents=True); stale.write_text("stale", encoding="utf-8")
            output = root / "build/tauri.release.json"
            self.assertEqual(prepare(root, output), output)
            self.assertEqual(config_path.read_text(encoding="utf-8"), config_text)
            stage = root / "build/release-resources"
            self.assertTrue((stage / "python/tracked.py").is_file())
            self.assertTrue((stage / "python/new.py").is_file(), "new release source must not be omitted before its first commit")
            self.assertFalse((stage / "python/ignored.py").exists())
            self.assertFalse((stage / "stale.txt").exists())
            self.assertEqual((stage / "bundled/spike-worker/spike-worker.exe").read_bytes(), b"worker")
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["bundle"]["resources"], {"../../build/release-resources/": "./"})

    def test_exported_source_manifest_replaces_git_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "RELEASE_SOURCE_MANIFEST.json").write_text(json.dumps({"files": [{"path": "python/adapter.py"}]}), encoding="utf-8")
            self.assertEqual(source_files(root), {"python/adapter.py"})


if __name__ == "__main__":
    unittest.main()
