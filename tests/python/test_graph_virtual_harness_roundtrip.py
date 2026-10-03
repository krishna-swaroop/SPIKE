"""Graph-authored virtual harness records survive native package reopen."""
import tempfile
import unittest
from pathlib import Path

from python.spike_core.harness_authoring import plan_harnesses
from python.spike_core.project_package import read_project, write_spike_package
from python.spike_core.spider_v2 import AssemblyIRV1
from tests.python.test_assembly_batch_import import active_design
from tests.python.test_harness_authoring import fixture


class GraphVirtualHarnessRoundTripTests(unittest.TestCase):
    def test_routed_harness_and_connector_positions_reopen(self):
        request = fixture()
        for board in request["assembly"]["boards"]:
            board["design_id"] = "base"
        proposal = plan_harnesses(request)
        self.assertEqual(len(proposal["harnesses"]), 1)
        assembly = request["assembly"]
        assembly["harnesses"] = proposal["harnesses"]
        assembly["connector_mappings"] = proposal["connector_mappings"]
        canonical = AssemblyIRV1.from_dict(assembly).to_dict()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "linked.spike"
            write_spike_package(path, {"project": {"id": "linked", "name": "Linked"},
                "design_ir": active_design(), "assembly_ir": canonical})
            reopened = read_project(path)
        restored = reopened.payload["assembly_ir"]
        self.assertEqual(restored["harnesses"][0]["pin_map"], {"1": "5", "2": "6"})
        route = restored["harnesses"][0]["extensions"]["spike.harness-routing"]
        self.assertEqual(route["endpoint_a_mm"], [0, 0, 0])
        self.assertEqual(route["endpoint_b_mm"], [100, 0, 0])
        self.assertGreaterEqual(len(route["route_mm"]), 2)
        self.assertEqual(len(restored["connector_mappings"]), 2)


if __name__ == "__main__":
    unittest.main()
