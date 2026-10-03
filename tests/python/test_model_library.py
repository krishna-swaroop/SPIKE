import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from spike_core import model_library


class ModelLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.index = self.base / "index.sqlite3"
        self.old_index = os.environ.get("SPIKE_MODEL_INDEX_PATH")
        self.old_library = os.environ.get("SPIKE_MODEL_LIBRARY")
        os.environ["SPIKE_MODEL_INDEX_PATH"] = str(self.index)
        os.environ["SPIKE_MODEL_LIBRARY"] = ""
        self.library = self.base / "models"
        self.library.mkdir()
        self.root_discovery = mock.patch(
            "spike_core.models.model_library_roots",
            side_effect=lambda additional=(): [Path(item).resolve() for item in additional if Path(item).is_dir()],
        )
        self.root_discovery.start()
        self.cli_discovery = mock.patch(
            "spike_core.models.kicad_scene_capabilities", return_value={"available": False, "path": ""}
        )
        self.cli_discovery.start()
        model_library._DISCOVERY_CACHE = None

    def tearDown(self):
        self.root_discovery.stop()
        self.cli_discovery.stop()
        if self.old_index is None:
            os.environ.pop("SPIKE_MODEL_INDEX_PATH", None)
        else:
            os.environ["SPIKE_MODEL_INDEX_PATH"] = self.old_index
        if self.old_library is None:
            os.environ.pop("SPIKE_MODEL_LIBRARY", None)
        else:
            os.environ["SPIKE_MODEL_LIBRARY"] = self.old_library
        self.temp.cleanup()

    def write(self, relative, data=b"model"):
        path = self.library / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_indexes_thousands_and_query_uses_cache(self):
        for number in range(2100):
            self.write(f"Bulk.3dshapes/item_{number}.step", str(number).encode())
        status = model_library.library_status(refresh=True, additional_roots=(self.library,))
        own = next(root for root in status["roots"] if root["root"] == str(self.library.resolve()))
        self.assertEqual(own["file_count"], 2100)
        with mock.patch.object(model_library, "_scan_root", side_effect=AssertionError("rescanned")):
            result = model_library.search_library("item_2099", additional_roots=(self.library,))
        self.assertEqual(result["entries"][0]["name"], "item_2099")

    def test_stale_root_is_refreshed_and_manual_refresh_handles_deep_change(self):
        self.write("A.3dshapes/one.step")
        model_library.library_status(refresh=True, additional_roots=(self.library,))
        self.write("two.step")
        os.utime(self.library, None)
        status = model_library.library_status(additional_roots=(self.library,))
        own = next(root for root in status["roots"] if root["root"] == str(self.library.resolve()))
        self.assertEqual(own["file_count"], 2)
        self.write("A.3dshapes/deep.step")
        refreshed = model_library.library_status(refresh=True, additional_roots=(self.library,))
        own = next(root for root in refreshed["roots"] if root["root"] == str(self.library.resolve()))
        self.assertEqual(own["file_count"], 3)

    def test_persisted_library_root_is_reused(self):
        self.write("Local.3dshapes/persisted.step")
        result = model_library.add_library_root(self.library)
        self.assertEqual(result["path"], str(self.library.resolve()))
        found = model_library.search_library("persisted")
        self.assertTrue(any(entry["name"] == "persisted" for entry in found["entries"]))

    def test_distinct_additional_roots_reuse_cache_and_do_not_leak_results(self):
        first = self.write("First.3dshapes/one.step")
        other = self.base / "other"
        second = other / "Second.3dshapes" / "two.step"
        second.parent.mkdir(parents=True)
        second.write_bytes(b"two")
        model_library.library_status(refresh=True, additional_roots=(self.library,))
        model_library.library_status(additional_roots=(other,))
        with mock.patch.object(model_library, "_scan_root", side_effect=AssertionError("rescanned")):
            first_results = model_library.search_library("", additional_roots=(self.library,))
        self.assertIn(str(first), [entry["path"] for entry in first_results["entries"]])
        self.assertNotIn(str(second), [entry["path"] for entry in first_results["entries"]])

    def test_nonexistent_original_and_ambiguous_basename_are_not_selected(self):
        self.write("A.3dshapes/shared.step", b"one")
        self.write("B.3dshapes/shared.step", b"two")
        model_library.library_status(refresh=True, additional_roots=(self.library,))
        missing = model_library.resolve_model(str(self.base / "missing.step"), additional_roots=(self.library,))
        self.assertEqual(missing["status"], "original_not_found")
        result = model_library.resolve_model("shared.step", additional_roots=(self.library,))
        self.assertIsNone(result["automatic_path"])
        self.assertEqual(len(result["candidates"]), 2)

    def test_existing_absolute_original_is_returned_exactly(self):
        original = self.write("outside-index.step", b"original")
        result = model_library.resolve_model(str(original), additional_roots=())
        self.assertEqual(result["status"], "resolved_original")
        self.assertEqual(result["automatic_path"], str(original.resolve()))

    def test_exact_footprint_mapping_is_safe(self):
        expected = self.write("Connector_USB.3dshapes/USB_C.step", b"exact")
        self.write("Connector_USB.3dshapes/USB_C.wrl", b"different representation")
        model_library.library_status(refresh=True, additional_roots=(self.library,))
        result = model_library.resolve_model(footprint="Connector_USB:USB_C", additional_roots=(self.library,))
        self.assertEqual(result["automatic_path"], str(expected))
        self.assertTrue(result["candidates"][0]["exact"])

    def test_explicit_relative_reference_wins_over_footprint_identity(self):
        requested = self.write("Custom.3dshapes/chosen.wrl", b"requested")
        self.write("Connector_USB.3dshapes/USB_C.step", b"footprint")
        model_library.library_status(refresh=True, additional_roots=(self.library,))
        result = model_library.resolve_model(
            "Custom.3dshapes/chosen.wrl", "Connector_USB:USB_C",
            additional_roots=(self.library,),
        )
        self.assertEqual(result["automatic_path"], str(requested))

    def test_standard_vrml_counterpart_requires_complete_package_identity(self):
        expected = self.write("A.3dshapes/part.step", b"correct")
        self.write("B.3dshapes/part.step", b"different package")
        resolved = model_library.resolve_model(
            "${KICAD8_3DMODEL_DIR}/A.3dshapes/part.wrl", additional_roots=(self.library,))
        self.assertEqual(resolved["automatic_path"], str(expected))
        self.assertEqual(resolved["candidates"][0]["reason"], "exact standard KiCad model STEP counterpart")
        for reference in ("${KICAD8_3DMODEL_DIR}/Missing.3dshapes/part.wrl", "${OLD_LIBRARY}/part.wrl"):
            with self.subTest(reference=reference):
                result = model_library.resolve_model(reference, additional_roots=(self.library,))
                self.assertIsNone(result["automatic_path"])
                self.assertEqual(result["status"], "candidates")

    def test_existing_standard_vrml_identity_wins_over_step_counterpart(self):
        requested = self.write("A.3dshapes/part.wrl", b"requested")
        self.write("A.3dshapes/part.step", b"alternative representation")
        result = model_library.resolve_model(
            "${KICAD8_3DMODEL_DIR}/A.3dshapes/part.wrl", additional_roots=(self.library,))
        self.assertEqual(result["automatic_path"], str(requested))

    def test_exact_duplicates_require_identical_content(self):
        other = self.base / "other"
        self.write("L.3dshapes/P.step", b"first")
        target = other / "L.3dshapes" / "P.step"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"second")
        model_library.library_status(refresh=True, additional_roots=(self.library, other))
        result = model_library.resolve_model("L.3dshapes/P.step", additional_roots=(self.library, other))
        self.assertEqual(result["status"], "ambiguous_exact")
        self.assertIsNone(result["automatic_path"])

    def test_confirmed_alias_is_hash_pinned_and_changed_asset_refused(self):
        target = self.write("Custom/widget.step", b"v1")
        with self.assertRaises(ValueError):
            model_library.register_alias("legacy", "", target)
        model_library.register_alias("legacy", "", target, confirmed=True)
        resolved = model_library.resolve_model("legacy", additional_roots=(self.library,))
        self.assertEqual(resolved["automatic_path"], str(target))
        target.write_bytes(b"v2")
        changed = model_library.resolve_model("legacy", additional_roots=(self.library,))
        self.assertEqual(changed["status"], "alias_changed")
        self.assertIsNone(changed["automatic_path"])

    def test_footprint_alias_applies_when_imported_reference_differs(self):
        target = self.write("Custom/approved.step", b"approved")
        model_library.register_alias("", "Vendor:Package", target, confirmed=True)
        resolved = model_library.resolve_model(
            "${KICAD9_3DMODEL_DIR}/Missing.3dshapes/Old.step",
            "Vendor:Package", additional_roots=(self.library,),
        )
        self.assertEqual(resolved["status"], "alias")
        self.assertEqual(resolved["automatic_path"], str(target))

    def test_changed_alias_does_not_fall_through_to_exact_library_match(self):
        target = self.write("L.3dshapes/P.step", b"v1")
        model_library.library_status(refresh=True, additional_roots=(self.library,))
        model_library.register_alias("L.3dshapes/P.step", "", target, confirmed=True)
        target.write_bytes(b"v2")
        result = model_library.resolve_model("L.3dshapes/P.step", additional_roots=(self.library,))
        self.assertEqual(result["status"], "alias_changed")
        self.assertIsNone(result["automatic_path"])

    def test_symlink_escape_is_not_indexed(self):
        outside = self.base / "outside.step"
        outside.write_bytes(b"outside")
        link = self.library / "escape.step"
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest("symlink creation unavailable")
        status = model_library.library_status(refresh=True, additional_roots=(self.library,))
        self.assertEqual(status["asset_count"], 0)


if __name__ == "__main__":
    unittest.main()
