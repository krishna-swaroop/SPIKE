import tempfile
import unittest
from pathlib import Path

from python.spike_core.contracts import SpiDeR
from python.spike_core.project_package import read_project, write_spike_package
from python.spike_core.service_project_handlers import handle_project_request
from python.spike_core.service_assembly_import import _board_bounds
from python.spike_core.spider_v2 import SpiDeRV2


def active_design():
    return SpiDeRV2.from_v1(SpiDeR(
        design_id="base", name="Base", source_format="neutral",
        layers=[{"id": 0, "name": "F.Cu"}],
        metadata={"source_sha256": "a" * 64},
    )).to_dict()


def board_source(path, net):
    path.write_text(
        '(kicad_pcb (version 20240108) (generator pcbnew) '
        '(general (thickness 1.6)) '
        '(layers (0 "F.Cu" signal) (31 "B.Cu" signal)) '
        f'(net 0 "") (net 1 "{net}"))',
        encoding="utf-8",
    )


class AssemblyBatchImportTests(unittest.TestCase):
    def test_two_boards_commit_together_with_separate_sources_and_placements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, first, second = root / "project.spike", root / "one.kicad_pcb", root / "two.kicad_pcb"
            board_source(first, "VCC")
            board_source(second, "GND")
            manifest = write_spike_package(project, {"project": {"id": "p", "name": "P"}, "design_ir": active_design()})
            response = handle_project_request("import_into_assembly_project", {
                "project_path": str(project), "source_paths": [str(first), str(second)],
                "expected_manifest_payload_sha256": manifest["manifest_payload_sha256"],
            }, request_id=1, application_version="test")
            self.assertTrue(response["ok"], response)
            result = response["result"]
            self.assertEqual([item["source_name"] for item in result["sources"]], [first.name, second.name])
            self.assertEqual([item["board_count"] for item in result["sources"]], [1, 1])
            loaded = read_project(project, include_members=True)
            boards = loaded.payload["assembly_ir"]["boards"]
            self.assertEqual(len(boards), 3)
            self.assertEqual(len(loaded.payload["assembly_designs"]["designs"]), 3)
            self.assertIn(first.read_bytes(), loaded.members.values())
            self.assertIn(second.read_bytes(), loaded.members.values())
            first_design = next(item for item in loaded.payload["assembly_designs"]["designs"] if item["design_id"] == boards[1]["design_id"])
            x0, _, x1, _ = _board_bounds(first_design)
            width = x1 - x0
            self.assertGreaterEqual(boards[2]["frame"]["transform"][3] - boards[1]["frame"]["transform"][3], width + 50)
            self.assertEqual(loaded.payload["audit"][-1]["source_names"], [first.name, second.name])

    def test_late_bad_source_rolls_back_entire_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, first, second = root / "project.spike", root / "one.kicad_pcb", root / "bad.kicad_pcb"
            board_source(first, "VCC")
            second.write_text("bad board", encoding="utf-8")
            manifest = write_spike_package(project, {"project": {"id": "p", "name": "P"}, "design_ir": active_design()})
            before = project.read_bytes()
            response = handle_project_request("import_into_assembly_project", {
                "project_path": str(project), "source_paths": [str(first), str(second)],
                "expected_manifest_payload_sha256": manifest["manifest_payload_sha256"],
            }, request_id=2, application_version="test")
            self.assertFalse(response["ok"])
            self.assertEqual(project.read_bytes(), before)

    def test_empty_or_excessive_batch_rejected_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project.spike"
            manifest = write_spike_package(project, {"project": {"id": "p", "name": "P"}, "design_ir": active_design()})
            before = project.read_bytes()
            for paths in ([], ["missing.kicad_pcb"] * 30):
                response = handle_project_request("import_into_assembly_project", {
                    "project_path": str(project), "source_paths": paths,
                    "expected_manifest_payload_sha256": manifest["manifest_payload_sha256"],
                }, request_id=3, application_version="test")
                self.assertFalse(response["ok"])
                self.assertEqual(project.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
