# SPDX-License-Identifier: Apache-2.0
import hashlib
from pathlib import Path
import tempfile
import unittest

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


if __name__ == "__main__":
    unittest.main()
