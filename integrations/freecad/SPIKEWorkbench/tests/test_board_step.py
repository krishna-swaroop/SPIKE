# SPDX-License-Identifier: MIT
"""Tests for KiCad STEP preparation without a FreeCAD installation."""

import os
import stat
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from spike_freecad.board_step import (  # noqa: E402
    build_step_export_arguments,
    discover_kicad_cli,
    validate_step_artifact,
    validate_step_paths,
    apply_step_to_document,
)


class _View:
    def __init__(self):
        self.Visibility = True


class _Object:
    def __init__(self, type_id, name):
        self.TypeId, self.Name, self.Label = type_id, name, name
        self.PropertiesList = []
        self.ViewObject = _View()
        self.Group = []

    def addProperty(self, _kind, name, _group):
        self.PropertiesList.append(name)

    def addObject(self, obj):
        self.Group.append(obj)


class _Document:
    def __init__(self, objects, fail_recompute=False):
        self.Objects = objects
        self.fail_recompute = fail_recompute
        self.aborted = False

    def openTransaction(self, _name): pass
    def commitTransaction(self): pass
    def abortTransaction(self): self.aborted = True

    def addObject(self, type_id, name):
        obj = _Object(type_id, name)
        self.Objects.append(obj)
        return obj

    def removeObject(self, name):
        self.Objects[:] = [obj for obj in self.Objects if obj.Name != name]
        for obj in self.Objects:
            if obj.TypeId == "App::DocumentObjectGroup":
                obj.Group[:] = [child for child in obj.Group if child.Name != name]

    def recompute(self):
        if self.fail_recompute:
            raise RuntimeError("recompute failed")


class BoardStepTests(unittest.TestCase):
    def test_dominant_substrate_is_separated_from_copper(self):
        fixture = self._apply_fixture()
        temporary, document, _group, _marker, _old, board, artifact = fixture
        solids = [types.SimpleNamespace(Volume=90.0),
                  types.SimpleNamespace(Volume=5.0),
                  types.SimpleNamespace(Volume=5.0)]
        shape = types.SimpleNamespace(Solids=solids)
        previous = sys.modules.get("Part")
        sys.modules["Part"] = types.SimpleNamespace(read=lambda _path: shape,
                                                   makeCompound=lambda items: tuple(items))
        try:
            substrate = apply_step_to_document(document, str(board), str(artifact), kind="board")
            copper = next(obj for obj in document.Objects
                          if getattr(obj, "SPIKEStepKind", "") == "copper")
            self.assertIs(substrate.Shape, solids[0])
            self.assertEqual(copper.Shape, tuple(solids[1:]))
            self.assertEqual(substrate.SPIKEColorRole, "substrate_green")
            self.assertEqual(copper.SPIKEColorRole, "copper_gold")
        finally:
            temporary.cleanup()
            if previous is None: sys.modules.pop("Part", None)
            else: sys.modules["Part"] = previous

    def _apply_fixture(self, fail_recompute=False):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        board = root / "board.kicad_pcb"
        artifact = root / "board.step"
        board.write_bytes(b"board")
        artifact.write_bytes(b"ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n")
        group = _Object("App::DocumentObjectGroup", "SPIKEKiCadLink")
        group.addProperty("App::PropertyString", "SPIKEKiCadSource", "SPIKE Link")
        marker = _Object("Part::Feature", "SPIKEPart")
        marker.addProperty("App::PropertyString", "SPIKEGeometryStatus", "SPIKE Link")
        marker.SPIKEGeometryStatus = "reference_only"
        marker.SPIKEReference = "U1"
        old = _Object("Part::Feature", "OldSTEP")
        old.addProperty("App::PropertyString", "SPIKEGeometryStatus", "SPIKE Link")
        old.SPIKEGeometryStatus = "detailed_step_approximate"
        group.Group = [marker, old]
        document = _Document([group, marker, old], fail_recompute)
        return temporary, document, group, marker, old, board, artifact

    def test_two_stage_apply_preserves_each_kind_and_hides_refs_for_board(self):
        fixture = self._apply_fixture()
        temporary, document, group, marker, old, board, artifact = fixture
        previous = sys.modules.get("Part")
        sys.modules["Part"] = types.SimpleNamespace(read=lambda _path: object())
        try:
            components = apply_step_to_document(
                document, str(board), str(artifact), kind="components")
            self.assertIn(marker, document.Objects)
            self.assertEqual(marker.SPIKEReference, "U1")
            self.assertTrue(marker.ViewObject.Visibility)
            self.assertIn(old, document.Objects)
            self.assertEqual(components.SPIKEGeometryStatus,
                             "detailed_step_components_approximate")

            board_feature = apply_step_to_document(
                document, str(board), str(artifact), kind="board")
            self.assertFalse(marker.ViewObject.Visibility)
            self.assertNotIn(old, document.Objects)
            self.assertIn(components, document.Objects)
            self.assertEqual(board_feature.SPIKEGeometryStatus,
                             "detailed_step_board_approximate")
        finally:
            temporary.cleanup()
            if previous is None: sys.modules.pop("Part", None)
            else: sys.modules["Part"] = previous

    def test_apply_failure_restores_reference_visibility(self):
        fixture = self._apply_fixture(fail_recompute=True)
        temporary, document, _group, marker, _old, board, artifact = fixture
        previous = sys.modules.get("Part")
        sys.modules["Part"] = types.SimpleNamespace(read=lambda _path: object())
        try:
            with self.assertRaises(RuntimeError):
                apply_step_to_document(document, str(board), str(artifact))
            self.assertTrue(document.aborted)
            self.assertTrue(marker.ViewObject.Visibility)
        finally:
            temporary.cleanup()
            if previous is None: sys.modules.pop("Part", None)
            else: sys.modules["Part"] = previous

    def test_missing_component_artifact_reports_unresolved_models(self):
        fixture = self._apply_fixture()
        temporary, document, _group, _marker, _old, board, artifact = fixture
        artifact.unlink()
        previous = sys.modules.get("Part")
        sys.modules["Part"] = types.SimpleNamespace(read=lambda _path: object())
        try:
            with self.assertRaisesRegex(ValueError, "may not have resolved any component models"):
                apply_step_to_document(
                    document, str(board), str(artifact), kind="components")
        finally:
            temporary.cleanup()
            if previous is None: sys.modules.pop("Part", None)
            else: sys.modules["Part"] = previous

    def test_discovery_prefers_configured_then_common_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            configured = root / ("configured.exe" if os.name == "nt" else "configured")
            common = root / ("kicad-cli.exe" if os.name == "nt" else "kicad-cli")
            for item in (configured, common):
                item.write_bytes(b"cli")
                item.chmod(item.stat().st_mode | stat.S_IXUSR)
            self.assertEqual(discover_kicad_cli(str(configured), path_env="", common_paths=[str(common)]),
                             str(configured.resolve()))
            self.assertEqual(discover_kicad_cli("", path_env="", common_paths=[str(common)]),
                             str(common.resolve()))

    def test_fixed_arguments_and_path_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            board = root / "board.kicad_pcb"
            output = root / "board.step"
            board.write_text("(kicad_pcb)", encoding="utf-8")
            args = build_step_export_arguments(str(board), str(output), kind="board")
            self.assertEqual(args[:3], ["pcb", "export", "step"])
            self.assertEqual(args[-3:], ["--output", str(output.resolve()), str(board.resolve())])
            for option in ("--force", "--subst-models", "--include-tracks", "--include-pads",
                           "--include-zones", "--include-inner-copper", "--cut-vias-in-body",
                           "--board-only"):
                self.assertIn(option, args)
            component_args = build_step_export_arguments(
                str(board), str(output), kind="components")
            self.assertIn("--no-board-body", component_args)
            self.assertIn("--subst-models", component_args)
            for option in ("--board-only", "--include-tracks",
                           "--include-pads", "--include-zones", "--include-inner-copper",
                           "--cut-vias-in-body"):
                self.assertNotIn(option, component_args)
            with self.assertRaises(ValueError):
                build_step_export_arguments(str(board), str(output), kind="invalid")
            with self.assertRaises(ValueError):
                validate_step_paths(str(root / "missing.kicad_pcb"), str(output))
            with self.assertRaises(ValueError):
                validate_step_paths(str(board), str(root / "board.obj"))

    def test_artifact_header_end_marker_and_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary) / "board.step"
            artifact.write_bytes(b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n")
            self.assertEqual(validate_step_artifact(str(artifact))[1], artifact.stat().st_size)
            with self.assertRaises(ValueError):
                validate_step_artifact(str(artifact), max_bytes=10)
            artifact.write_bytes(b"ISO-10303-21;\nHEADER;\n")
            with self.assertRaises(ValueError):
                validate_step_artifact(str(artifact))
            artifact.write_bytes(b"not a step file END-ISO-10303-21;")
            with self.assertRaises(ValueError):
                validate_step_artifact(str(artifact))


if __name__ == "__main__":
    unittest.main()
