# SPDX-License-Identifier: Apache-2.0
"""Capture verified retained KiCad display assets for the browser scene check."""
from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY / "python"))
sys.path.append(str(REPOSITORY))

from spike_core.assembly_visuals import prepare_assembly_design_visual_bundle
from spike_core.project_package import read_project


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, help="Retained .spike assembly project")
    parser.add_argument("--design-id", required=True, help="Retained design to display")
    parser.add_argument("--output", type=Path, default=REPOSITORY / "app/.tmp/assembly-performance")
    args = parser.parse_args()
    project = args.project.resolve(strict=True)
    opened = read_project(project)
    result = prepare_assembly_design_visual_bundle({
        "project_path": str(project),
        "expected_manifest_payload_sha256": opened.manifest["manifest_payload_sha256"],
        "design_id": args.design_id,
        "stage": "ready",
    })
    if result["status"] != "ready":
        raise RuntimeError(json.dumps(result.get("stage_diagnostics") or result.get("stage_errors")))
    artifacts = {}
    for bundle in result["bundles"].values():
        for kind, artifact in bundle.get("scenes", {}).items():
            if kind in {"board", "components"}:
                artifacts[kind] = base64.b64decode(artifact["artifact_base64"], validate=True)
    if set(artifacts) != {"board", "components"}:
        raise RuntimeError("This verification page requires resolved board and component GLB scenes.")
    source = json.dumps(result["source"]["snapshot"])
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "source.json").write_text(source, encoding="utf-8")
    for kind, data in artifacts.items():
        (args.output / f"{kind}.glb").write_bytes(data)
    print(json.dumps({"status": result["status"], "output": str(args.output.resolve())}))


if __name__ == "__main__":
    main()
