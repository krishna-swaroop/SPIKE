# SPDX-License-Identifier: Apache-2.0
"""Rerun curated PI/SI/thermal requests through the desktop JSON-line worker."""
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def call_worker(method, params):
    completed = subprocess.run(
        [sys.executable, "-W", "error", "-m", "python.spike_core.service"],
        input=json.dumps({"id": f"curated-{method}", "method": method, "params": params}) + "\n",
        text=True, capture_output=True, cwd=ROOT, timeout=90, check=True,
    )
    response = json.loads(completed.stdout)
    if not response.get("ok"):
        raise RuntimeError(response)
    return response["result"]


def verify(directory):
    projects = list(directory.glob("*.spike"))
    if len(projects) != 1:
        raise RuntimeError("Choose an example directory containing exactly one .spike package")
    project = projects[0]
    opened = call_worker("read_project_package", {"path": str(project.resolve())})
    assembly = opened["canonical"]["assembly_ir"]
    studies = assembly["extensions"]["spike.multiboard-studies"]
    checks = []
    for domain in ("pi", "si", "thermal"):
        request_path = directory / f"{domain}-request.json"
        request = json.loads(request_path.read_text(encoding="utf-8"))
        expected = json.loads((directory / f"{domain}-result.json").read_text(encoding="utf-8"))
        method = "run_multiboard_thermal" if domain == "thermal" else "run_multiboard_circuit"
        started = time.perf_counter()
        result = call_worker(method, {"request": request})
        if result != expected or result.get("status") != "completed":
            raise RuntimeError(f"{directory.name}/{domain}: worker result differs from saved evidence")
        retained = studies[domain]
        if retained["result"] != expected:
            raise RuntimeError(f"{directory.name}/{domain}: reopened result differs from saved evidence")
        call_worker("validate_multiboard_study_result", {
            "assembly": assembly, "domain": domain,
            "request": retained["request"], "result": retained["result"],
        })
        checks.append({"domain": domain, "status": "completed", "matches_saved_result": True,
                       "reopened_result_matches": True, "retained_result_binding_valid": True,
                       "elapsed_seconds": round(time.perf_counter() - started, 3),
                       "request_sha256": hashlib.sha256(request_path.read_bytes()).hexdigest()})
    record = {"contract": "spike/curated-worker-verification/v1",
              "project_sha256": hashlib.sha256(project.read_bytes()).hexdigest(),
              "manifest_payload_sha256": opened["manifest"]["manifest_payload_sha256"], "checks": checks}
    (directory / "worker-verification.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directories", nargs="+", type=Path)
    args = parser.parse_args()
    for directory in args.directories:
        print(json.dumps({"directory": str(directory), **verify(directory)}, indent=2))


if __name__ == "__main__":
    main()
