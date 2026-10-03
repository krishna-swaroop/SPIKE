# SPDX-License-Identifier: Apache-2.0
import copy
import unittest
from python.spike_core.assembly_linked_nets import linked_assembly_nets
from tests.python.test_multiboard_circuit import fixture


class LinkedAssemblyNetTests(unittest.TestCase):
    def request(self):
        assembly = fixture()["assembly"]
        assembly["boards"].append({"id": "c", "design_id": "same-layout"})
        assembly["connector_mappings"] = [{"id": f"{b}-J", "kind": "connector", "data": {
            "board_id": b, "connector_id": "J", "position_mm": [0, 0, 0], "pins": {"1": "power", "2": "return"}}} for b in ("a", "b", "c")]
        return {"assembly": assembly, "designs": {"same-layout": {"nets": [{"id": "power", "name": "VCC"}, {"id": "return", "name": "GND"}]}}, "board_id": "a", "net_id": "power"}

    def test_explicit_links_only_across_repeated_designs(self):
        raw = self.request(); original = copy.deepcopy(raw)
        result = linked_assembly_nets(raw)
        self.assertEqual([(n["board_id"], n["net_id"]) for n in result["nodes"]], [("a", "power"), ("b", "power")])
        self.assertEqual(raw, original)
        raw["assembly"]["connector_mappings"].append({"id": "mate", "kind": "connector-mate", "data": {"endpoint_a": "b::J", "endpoint_b": "c::J", "pin_map": {"1": "1"}}})
        # A connector pin cannot be occupied by both cable and mate.
        raw["assembly"]["harnesses"][0]["pin_map"] = {"2": "2"}
        raw["board_id"] = "b"
        self.assertEqual([n["board_id"] for n in linked_assembly_nets(raw)["nodes"]], ["b", "c"])

    def test_unknown_selection_and_unresolved_pin(self):
        raw = self.request(); raw["net_id"] = "VCC"
        with self.assertRaises(ValueError): linked_assembly_nets(raw)
        raw["net_id"] = "power"
        raw["assembly"]["connector_mappings"][1]["data"]["pins"]["1"] = "unknown"
        result = linked_assembly_nets(raw)
        self.assertEqual(len(result["nodes"]), 1)
        self.assertEqual(len(result["unresolved_pin_links"]), 1)

    def test_worker_route(self):
        from python.spike_core.service import handle
        result = handle({"id": "linked", "method": "linked_assembly_nets", "params": {"request": self.request()}})
        self.assertTrue(result["ok"], result)
        self.assertEqual(len(result["result"]["nodes"]), 2)
