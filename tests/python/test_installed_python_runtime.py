# SPDX-License-Identifier: Apache-2.0
"""Contracts for the installed frozen-worker external-Python verifier."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.verify_installed_python_runtime import (
    MAX_WORKER_RESPONSE_BYTES,
    VerificationError,
    _invoke,
    _installed_file,
    _parse_worker_response,
)


def response(**updates: object) -> bytes:
    value = {
        "id": "probe",
        "ok": True,
        "result": {},
        "meta": {"contract": "spike/worker-response-meta/v1"},
    }
    value.update(updates)
    return json.dumps(value).encode("utf-8") + b"\n"


class InstalledPythonRuntimeVerifierTests(unittest.TestCase):
    def test_accepts_one_matching_json_line_response(self) -> None:
        parsed = _parse_worker_response(response(), "probe")
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["id"], "probe")

    def test_rejects_malformed_unbounded_or_mismatched_worker_responses(self) -> None:
        cases = {
            "empty": b"",
            "invalid JSON": b"not-json\n",
            "non-object": b"[]\n",
            "multiple lines": response() + response(),
            "wrong ID": response(id="other"),
            "missing ok": json.dumps({
                "id": "probe", "meta": {"contract": "spike/worker-response-meta/v1"},
            }).encode() + b"\n",
            "bad metadata": response(meta={"contract": "wrong"}),
            "oversize": b"x" * (MAX_WORKER_RESPONSE_BYTES + 1),
        }
        for label, payload in cases.items():
            with self.subTest(label=label), self.assertRaises(VerificationError):
                _parse_worker_response(payload, "probe")

    def test_import_evidence_must_resolve_to_exact_installed_resource(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            expected = root / "extensions/emerge_suite/normalize.py"
            expected.parent.mkdir(parents=True)
            expected.write_text("# installed fixture\n", encoding="utf-8")
            self.assertEqual(
                _installed_file(str(expected), root, "extensions/emerge_suite/normalize.py"),
                expected,
            )
            outside = root.parent / "normalize.py"
            with self.assertRaisesRegex(VerificationError, "escaped"):
                _installed_file(str(outside), root, "extensions/emerge_suite/normalize.py")
            wrong = root / "extensions/emerge_suite/other.py"
            wrong.write_text("# wrong fixture\n", encoding="utf-8")
            with self.assertRaisesRegex(VerificationError, "expected"):
                _installed_file(str(wrong), root, "extensions/emerge_suite/normalize.py")

    def test_worker_response_wait_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            worker = root / "spike-worker.exe"
            worker.write_bytes(b"fixture")
            with patch(
                "scripts.verify_installed_python_runtime.subprocess.run",
                side_effect=subprocess.TimeoutExpired([str(worker)], 45),
            ):
                with self.assertRaisesRegex(VerificationError, "within 45 seconds"):
                    _invoke(worker, root, "probe", {"code": "pass"})


if __name__ == "__main__":
    unittest.main()
