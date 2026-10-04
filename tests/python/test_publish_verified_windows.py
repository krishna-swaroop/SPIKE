# SPDX-License-Identifier: Apache-2.0
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import os

from scripts import publish_verified_windows as publisher
from scripts.publish_verified_windows import verify_assets


class VerifiedWindowsAssetsTests(unittest.TestCase):
    def test_exact_installer_and_checksum_required(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            name = "SPIKE_0.3.7_x64-setup.exe"
            content = b"completed-installer-fixture"
            (folder / name).write_bytes(content)
            digest = hashlib.sha256(content).hexdigest()
            with self.assertRaises(ValueError):
                verify_assets(folder, "0.3.7")
            checksum = folder / (name + ".sha256")
            checksum.write_text(f"{digest}  {name}\n")
            self.assertEqual(verify_assets(folder, "0.3.7"), (name, digest))
            checksum.write_text(f"{digest}  wrong.exe\n")
            with self.assertRaisesRegex(ValueError, "filename mismatch"):
                verify_assets(folder, "0.3.7")
            checksum.write_text(f"{digest}  {name}\n")
            (folder / name).write_bytes(b"changed-after-hashing")
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_assets(folder, "0.3.7")
            (folder / name).write_bytes(content)
            (folder / "unexpected.txt").write_text("unexpected")
            with self.assertRaisesRegex(ValueError, "exactly"):
                verify_assets(folder, "0.3.7")

    def test_matching_draft_without_tag_ref_can_resume(self):
        import json
        commit = "a" * 40
        digest = "b" * 64
        name = "SPIKE_0.3.7_x64-setup.exe"
        run = {"conclusion": "success", "head_sha": commit, "path": ".github/workflows/windows-release.yml"}
        draft = {"tag_name": "v0.3.7", "draft": True, "target_commitish": commit,
                 "assets": [{"name": name, "digest": "sha256:" + digest}, {"name": name + ".sha256"}]}
        calls = []
        def execute(*args):
            calls.append(args)
            if args[:2] == ("git", "show"):
                return json.dumps({"version": "0.3.7"}) if args[2].endswith("package.json") else "Release notes"
            if args[:2] == ("gh", "api"):
                return json.dumps([draft] if "/releases?" in args[2] else run)
            return ""
        env = {"VERIFIED_WINDOWS_RUN": "123", "REVIEWED_RELEASE_COMMIT": commit, "GITHUB_REPOSITORY": "owner/repo"}
        with patch.dict(os.environ, env), patch.object(publisher, "command", side_effect=execute), \
             patch.object(publisher, "verify_assets", return_value=(name, digest)), patch.object(Path, "write_text"):
            publisher.main()
            self.assertTrue(any(call[:3] == ("gh", "release", "edit") for call in calls))
            self.assertFalse(any(call[:3] == ("gh", "release", "create") for call in calls))
            draft["target_commitish"] = "c" * 40
            with self.assertRaisesRegex(ValueError, "another source"):
                publisher.main()


if __name__ == "__main__":
    unittest.main()
