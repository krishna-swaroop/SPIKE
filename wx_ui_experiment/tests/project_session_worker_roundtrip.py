"""Worker-level evidence for the C++ ProjectSession request contract."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from python.spike_core.service import handle


SOURCE = """(kicad_pcb\n  (version 20240108)\n  (generator pcbnew)\n  (layers (0 \"F.Cu\" signal))\n  (net 0 \"\")\n  (net 1 \"VOUT-micro\")\n)\n"""


class ProjectSessionWorkerRoundTripTest(unittest.TestCase):
    def worker(self, request_id: str, method: str, params: dict) -> dict:
        response = handle({"id": request_id, "method": method, "params": params})
        self.assertTrue(response["ok"], response.get("error"))
        return response["result"]

    def test_open_save_as_reopen_preserves_source_and_unknown_state(self) -> None:
        with tempfile.TemporaryDirectory(prefix="spike-wx-project-session-") as directory:
            root = Path(directory)
            original = root / "original.spike"
            saved_as = root / "saved-as.spike"
            snapshot = {
                "format": "spike-project-package/v2",
                "contract": "spike/project/v2",
                "project": {"name": "original.spike", "future_project": {"owner": "newer-client"}},
                "design": {
                    "source_file": "exact-source.kicad_pcb",
                    "source_format": "kicad_pcb",
                    "source_board": SOURCE,
                    "stackup": [],
                },
                "analysis": {"mode": "DC IR Drop", "future_analysis": {"revision": 7}},
                "future_top_level": {"preserve": [1, 2, 3]},
            }
            self.worker("seed", "write_project_package", {
                "path": str(original),
                "snapshot": snapshot,
                "profile": "portable_project",
                "include_results": True,
            })

            # This is exactly ProjectSession::project_open_request.
            opened = self.worker("open", "read_project_package", {"path": str(original)})
            retained = opened["project"]
            self.assertEqual(retained["design"]["source_board"], SOURCE)
            self.assertEqual(opened["canonical"]["design_ir"]["contract"], "spike/design-ir/v2")

            # This is ProjectSession::edit_project followed by
            # ProjectSession::project_save_request.
            retained["analysis"]["mode"] = "AC Impedance Sweep"
            self.worker("save-as", "write_project_package", {
                "path": str(saved_as),
                "snapshot": retained,
                "profile": "portable_project",
                "include_results": True,
                "base_package_path": str(original),
            })

            reopened = self.worker("reopen", "read_project_package", {"path": str(saved_as)})
            project = reopened["project"]
            self.assertEqual(project["analysis"]["mode"], "AC Impedance Sweep")
            self.assertEqual(project["analysis"]["future_analysis"], {"revision": 7})
            self.assertEqual(project["future_top_level"], {"preserve": [1, 2, 3]})
            self.assertEqual(project["project"]["future_project"], {"owner": "newer-client"})
            self.assertEqual(project["design"]["source_board"], SOURCE)
            self.assertEqual(
                reopened["canonical"]["design_ir"]["source"]["source_digest"],
                opened["canonical"]["design_ir"]["source"]["source_digest"],
            )

    def test_imported_project_envelope_is_accepted_without_a_base_package(self) -> None:
        with tempfile.TemporaryDirectory(prefix="spike-wx-import-session-") as directory:
            root = Path(directory)
            source_path = root / "imported.kicad_pcb"
            package_path = root / "imported.spike"
            source_path.write_text(SOURCE, encoding="utf-8", newline="")
            imported = self.worker("import", "import_design_v2", {
                "path": str(source_path),
                "include_snapshot": True,
            })
            design_snapshot = imported["snapshot"]

            # This is the bounded envelope produced by
            # ProjectSession::create_project_from_import.
            snapshot = {
                "format": "spike-project-package/v2",
                "contract": "spike/project/v2",
                "project": {"name": "imported.spike"},
                "design": {
                    "canonical_design": design_snapshot["canonical_design"],
                    "source_file": str(source_path),
                    "source_format": "kicad_pcb",
                    "source_board": SOURCE,
                    "stackup": design_snapshot["design"].get("stackup", []),
                },
                "analysis": {},
            }
            self.worker("first-save", "write_project_package", {
                "path": str(package_path),
                "snapshot": snapshot,
                "profile": "portable_project",
                "include_results": True,
            })
            reopened = self.worker("reopen-import", "read_project_package", {
                "path": str(package_path),
            })
            self.assertEqual(reopened["project"]["design"]["source_board"], SOURCE)
            self.assertEqual(reopened["canonical"]["design_ir"]["contract"], "spike/design-ir/v2")
            self.assertEqual(reopened["project"]["project"]["name"], "imported.spike")


if __name__ == "__main__":
    unittest.main()
