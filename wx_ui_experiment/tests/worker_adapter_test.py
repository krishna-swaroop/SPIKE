"""The native worker adapter must use the shared canonical projection."""
import copy
import tempfile
import unittest
from pathlib import Path
from python.spike_core import service
from python.spike_core.spider_v2 import SpiDeRV2
from wx_ui_experiment import worker_adapter
from wx_ui_experiment.tests.project_session_worker_roundtrip import SOURCE


class AdapterTest(unittest.TestCase):
    def test_canonical_validation_matches_existing_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            board = Path(directory) / "input.kicad_pcb"
            board.write_text(SOURCE, encoding="utf-8")
            imported = service.handle({"method": "import_design_v2", "params": {
                "path": str(board), "include_snapshot": True}})
            self.assertTrue(imported["ok"], imported.get("error"))
            canonical = imported["result"]["snapshot"]["canonical_design"]
            request = {"id": 42, "method": "validate_design", "params": {"design": canonical}}
            before = copy.deepcopy(request)
            expected = service.handle({**request, "params": {
                "design": SpiDeRV2.from_dict(canonical).to_v1().to_dict()}})
            self.assertEqual(worker_adapter.handle(request), expected)
            self.assertEqual(request, before)

    def test_other_methods_pass_through(self):
        request = {"id": 1, "method": "health", "params": {}}
        self.assertEqual(worker_adapter.handle(request), service.handle(request))


if __name__ == "__main__":
    unittest.main()
