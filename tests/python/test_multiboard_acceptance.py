# SPDX-License-Identifier: Apache-2.0
"""End-to-end packaged three-board acceptance with actual reduced solves."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_multiboard_acceptance import build
from python.spike_core.project_package import read_project
from python.spike_core.harness_authoring import validate_harness_connections
from python.spike_core.spider_v2 import AssemblyIRV1


class MultiboardAcceptanceTests(unittest.TestCase):
    def test_builds_three_occurrences_and_executes_coupled_models(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            summary = build(output)
            project = read_project(output / summary["project"], include_members=True)
            assembly = AssemblyIRV1.from_dict(project.payload["assembly_ir"])
            validate_harness_connections(assembly)
            self.assertEqual([board.id for board in assembly.boards],
                             ["ebrake-source", "ebrake-stacked", "ebrake-side"])
            self.assertEqual(len({board.design_id for board in assembly.boards}), 1)
            self.assertEqual(len(project.payload["assembly_designs"]["designs"]), 1)
            self.assertEqual(len(assembly.harnesses), 1)
            self.assertEqual(len(assembly.thermal_contacts), 1)
            self.assertEqual(sum(item.kind == "connector-mate" for item in assembly.connector_mappings), 1)
            self.assertEqual(project.manifest["manifest_payload_sha256"], summary["manifest_payload_sha256"])
            for domain in ("pi", "si", "thermal"):
                result = json.loads((output / f"{domain}-result.json").read_text(encoding="utf-8"))
                self.assertEqual(result["status"], "completed", domain)
                self.assertFalse(result["production_qualified"])
            thermal = json.loads((output / "thermal-result.json").read_text(encoding="utf-8"))
            self.assertGreater(thermal["board_temperatures_c"]["ebrake-stacked"]["board"], 25.0)
            self.assertGreater(thermal["board_temperatures_c"]["ebrake-side"]["board"], 25.0)
            self.assertLess(abs(thermal["summary"]["energy_balance_residual_w"]), 1e-8)
            radiative_w = abs(thermal["radiation_exchange"][0]["heat_flow_w"])
            conductive_w = abs(thermal["contact_heat_flows"][0]["heat_flow_w"])
            self.assertGreater(radiative_w, conductive_w)
            sensitivity = json.loads((output / "thermal-powered-board-sensitivity.json").read_text(encoding="utf-8"))
            self.assertGreater(sensitivity["source_temperature_change_c"], 0.0)
            self.assertEqual(sensitivity["source_power_w"], 0.2)
            route = json.loads((output / "routed-resistance.json").read_text(encoding="utf-8"))
            self.assertGreater(route["mesh_branch_count"], 0)
            self.assertIn(route["connector_path_status"], {"connected", "disconnected_in_extracted_mesh"})


if __name__ == "__main__":
    unittest.main()
