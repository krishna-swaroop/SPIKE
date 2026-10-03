"""Manifest and design identity binding for assembly visual preparation."""

from __future__ import annotations

import hashlib
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from python.spike_core.assembly_visuals import _design_snapshot, _stage_packaged_step_overrides, prepare_assembly_design_visual_bundle
from python.spike_core.contracts import SpiDeR, ValidationIssue
from python.spike_core.project_package import ProjectPackageError, write_spike_package
from python.spike_core.spider_v2 import SpiDeRV2


def design(identity: str, source: bytes, suffix: str = ".kicad_pcb") -> dict:
    digest = hashlib.sha256(source).hexdigest()
    result = SpiDeRV2.from_v1(SpiDeR(
        design_id=identity, name=identity, source_format="kicad_pcb",
        layers=[{"id": 0, "name": "F.Cu"}], metadata={"source_sha256": digest},
    )).to_dict()
    result["source"]["artifact_path"] = f"package:sources/{digest}{suffix}"
    return result


class AssemblyVisualTests(unittest.TestCase):
    def test_source_snapshot_preserves_structured_issues_in_json(self):
        retained = SpiDeRV2.from_v1(SpiDeR(design_id="issue-board", name="Board", source_format="kicad_pcb",
            issues=[ValidationIssue(severity="warning", code="FIXTURE_ISSUE", message="Review model assignment")])).to_dict()
        snapshot = json.loads(json.dumps(_design_snapshot(retained)))
        self.assertEqual(snapshot["report"]["issues"][0]["code"], "FIXTURE_ISSUE")
        self.assertEqual(snapshot["report"]["issues"], snapshot["canonical_design"]["issues"])

    def test_packaged_step_override_is_manifest_read_and_exact_source_bound(self):
        retained = {
            "components": [{"id": "component", "model_ids": ["step-model", "unused-model"]}],
            "models": [
                {"id": "step-model", "uri": "${KIPRJMOD}/models/custom.step"},
                {"id": "unused-model", "uri": "not-in-source.step"},
            ],
        }
        payload = {"models": {"models": [
            {"id": "step-model", "model_type": "step"},
            {"id": "unused-model", "model_type": "step"},
        ]}}
        source = '(kicad_pcb (footprint "X" (model "${KIPRJMOD}/models/custom.step")))'
        with tempfile.TemporaryDirectory() as directory, patch(
            "python.spike_core.assembly_visuals.read_step_model_artifact",
            return_value={"artifact": b"verified packaged step"},
        ) as read:
            overrides = _stage_packaged_step_overrides(
                Path(directory) / "project.spike", "a" * 64, payload, retained, source, Path(directory),
            )
            staged = Path(overrides["${KIPRJMOD}/models/custom.step"])
            self.assertEqual(staged.read_bytes(), b"verified packaged step")
        read.assert_called_once_with(
            Path(directory) / "project.spike", "step-model",
            expected_manifest_payload_sha256="a" * 64,
            max_total_bytes=128 * 1024 * 1024,
        )

    def fixture(self, root: Path):
        active_bytes = b'(kicad_pcb (version 20240108) (generator pcbnew) (layers (0 "F.Cu" signal)) (net 0 "ACTIVE"))'
        other_bytes = b'(kicad_pcb\r\n (version 20240108) (generator pcbnew) (layers (0 "F.Cu" signal)) (net 0 "OTHER"))'
        active, other = design("active", active_bytes), design("other", other_bytes)
        path = root / "assembly.spike"
        manifest = write_spike_package(path, {
            "project": {"id": "assembly"}, "design_ir": active,
            "assembly_ir": {"contract": "spike/assembly-ir/v1", "assembly_id": "assembly", "name": "Assembly", "boards": []},
            "assembly_designs": {"contract": "spike/assembly-designs/v1", "active_design_id": active["design_id"], "designs": [active, other]},
        }, source_artifacts={"active.kicad_pcb": active_bytes, "other.kicad_pcb": other_bytes})
        return path, manifest["manifest_payload_sha256"], active, other, active_bytes, other_bytes

    def params(self, path: Path, manifest: str, design_id: str, stage: str = "source") -> dict:
        return {"project_path": str(path), "expected_manifest_payload_sha256": manifest,
                "design_id": design_id, "stage": stage}

    def test_source_stage_reads_exact_non_active_design_and_returns_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, _, other, _, expected = self.fixture(Path(directory))
            result = prepare_assembly_design_visual_bundle(self.params(path, manifest, other["design_id"]))
        self.assertEqual(result["design_id"], other["design_id"])
        self.assertEqual(result["source_board"].encode("utf-8"), expected)
        self.assertTrue(result["source_file"].endswith(".kicad_pcb"))
        self.assertEqual(result["snapshot"]["contract"], "spike/design-snapshot/v1")
        self.assertEqual(result["snapshot"]["canonical_design"]["design_id"], other["design_id"])
        self.assertEqual(result["snapshot"]["design"]["contract"], "spike/v1")
        self.assertEqual(result["quality"], {
            "component_count": 0, "model_assigned_component_count": 0, "source_model_reference_count": 0,
        })

    def test_unknown_design_and_stale_manifest_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, active, _, _, _ = self.fixture(Path(directory))
            with self.assertRaisesRegex(ProjectPackageError, "not retained"):
                prepare_assembly_design_visual_bundle(self.params(path, manifest, "missing"))
            with self.assertRaisesRegex(ProjectPackageError, "changed"):
                prepare_assembly_design_visual_bundle(self.params(path, "0" * 64, active["design_id"]))

    def test_visual_stage_exports_the_selected_design_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, _, other_design, active, other = self.fixture(Path(directory))
            with patch("python.spike_core.assembly_visuals.prepare_visual_bundle", return_value={"contract": "spike/visual-bundle/v1"}) as prepare:
                result = prepare_assembly_design_visual_bundle(self.params(path, manifest, other_design["design_id"], "board"))
        self.assertEqual(result["contract"], "spike/visual-bundle/v1")
        self.assertEqual(result["quality"]["component_count"], 0)
        self.assertFalse(result["quality"]["component_geometry_scene_loaded"])
        call = prepare.call_args.args[0]
        self.assertEqual(call["source_board"].encode("utf-8"), other)
        self.assertNotEqual(call["source_board"].encode("utf-8"), active)
        self.assertEqual(call["stage"], "board")

    def test_component_stage_reports_absent_source_assignments_before_kicad(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, _, other, _, _ = self.fixture(Path(directory))
            with patch("python.spike_core.assembly_visuals.prepare_visual_bundle") as prepare:
                with self.assertRaisesRegex(ProjectPackageError, "0 of 0 components"):
                    prepare_assembly_design_visual_bundle(self.params(path, manifest, other["design_id"], "components"))
        prepare.assert_not_called()

    def test_ready_stage_reads_package_once_and_skips_unassigned_components(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, _, other, _, _ = self.fixture(Path(directory))
            payload = {"contract": "spike/visual-bundle-payload/v1", "quality": {}}
            with patch(
                "python.spike_core.assembly_visuals.read_project",
                wraps=__import__("python.spike_core.assembly_visuals", fromlist=["read_project"]).read_project,
            ) as read, patch(
                "python.spike_core.assembly_visuals.prepare_visual_bundle", return_value=payload,
            ) as prepare, patch(
                "python.spike_core.assembly_visuals._stage_packaged_step_overrides", return_value={},
            ) as stage_models:
                result = prepare_assembly_design_visual_bundle(
                    self.params(path, manifest, other["design_id"], "ready")
                )
        self.assertEqual(result["contract"], "spike/assembly-visual-ready/v1")
        self.assertEqual(result["manifest_payload_sha256"], manifest)
        self.assertEqual(result["source"]["source_digest"], other["source"]["source_digest"])
        self.assertEqual(set(result["bundles"]), {"layout", "board"})
        self.assertEqual(result["skipped_stages"], ["components"])
        self.assertEqual([call.args[0]["stage"] for call in prepare.call_args_list], ["layout", "board"])
        self.assertEqual(read.call_count, 1)
        stage_models.assert_called_once()

    def test_ready_stages_run_concurrently_and_keep_response_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, _, other, _, _ = self.fixture(Path(directory))
            entered = []
            barrier = threading.Barrier(2, timeout=5)

            def prepare(request):
                entered.append(request["stage"])
                barrier.wait()
                return {"contract": "spike/visual-bundle-payload/v1", "quality": {}}

            with patch("python.spike_core.assembly_visuals.prepare_visual_bundle", side_effect=prepare):
                result = prepare_assembly_design_visual_bundle(
                    self.params(path, manifest, other["design_id"], "ready")
                )
        self.assertCountEqual(entered, ["layout", "board"])
        self.assertEqual(list(result["bundles"]), ["layout", "board"])
        self.assertEqual(result["recovery"], {
            "preserved_stages": ["layout", "board"],
            "retryable_stages": [],
            "reopen_project_required": False,
        })

    def test_ready_stage_retains_source_and_reports_optional_stage_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            path, manifest, _, other, _, _ = self.fixture(Path(directory))
            board = {"contract": "spike/visual-bundle-payload/v1", "quality": {}}
            def prepare(request):
                if request["stage"] == "layout":
                    raise RuntimeError("layout unavailable")
                return board
            with patch(
                "python.spike_core.assembly_visuals.prepare_visual_bundle",
                side_effect=prepare,
            ):
                result = prepare_assembly_design_visual_bundle(
                    self.params(path, manifest, other["design_id"], "ready")
                )
        self.assertEqual(result["status"], "ready_with_errors")
        self.assertEqual(result["stage_errors"], {"layout": "layout unavailable"})
        diagnostic = result["stage_diagnostics"]["layout"]
        self.assertEqual(diagnostic["code"], "SPIKE-BE-VIEW-E-0001")
        self.assertEqual(diagnostic["context"], {"stage": "layout"})
        self.assertTrue(diagnostic["recoverable"])
        self.assertTrue(diagnostic["retryable"])
        self.assertEqual(result["recovery"], {
            "preserved_stages": ["board"],
            "retryable_stages": ["layout"],
            "reopen_project_required": False,
        })
        self.assertEqual(set(result["bundles"]), {"board"})
        self.assertEqual(result["source"]["design_id"], other["design_id"])


if __name__ == "__main__":
    unittest.main()
