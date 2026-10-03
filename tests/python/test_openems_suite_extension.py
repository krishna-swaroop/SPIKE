# SPDX-License-Identifier: Apache-2.0
"""OpenEMS suite discovery, UI manifest and process preflight coverage."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from python.spike_core.extensions import ExtensionManifest, ProcessExtension
from tests.python.test_external_engines import openems_design


ROOT = Path(__file__).resolve().parents[2] / "extensions" / "openems_suite"


class OpenemsSuiteExtensionTests(unittest.TestCase):
    def setUp(self):
        self.manifest = ExtensionManifest.from_dict(json.loads((ROOT / "spike-extension.json").read_text(encoding="utf-8")))
        self.extension = ProcessExtension(self.manifest, ROOT, trusted=True)

    def test_menu_items_are_declared_and_thermal_is_absent(self):
        self.assertEqual(self.manifest.ui["menu_items"], ["openems-pi", "openems-si", "openems-em", "openems-mesh"])
        self.assertEqual({item["id"] for item in self.manifest.contributes["applications"]}, {"openems-pi", "openems-si", "openems-em", "openems-mesh", "openems-preview"})
        self.assertEqual({item["id"] for item in self.manifest.contributes["analyses"]}, {"openems-pi-solve", "openems-si-solve", "openems-em-solve"})
        raw = self.manifest.to_dict()
        raw["ui"] = {"menu_items": ["missing-action"]}
        with self.assertRaisesRegex(ValueError, "menu_items"):
            ExtensionManifest.from_dict(raw)

    def test_pi_and_si_preflight_use_existing_adapter(self):
        design = openems_design().to_dict()
        for contribution, domain in (("openems-pi", "pi"), ("openems-si", "si"), ("openems-em", "emi")):
            result = self.extension.invoke(contribution, {"design": design, "parameters": {
                "operation": "preflight", "analysis": {
                    "net_names": ["RF"], "frequency_start_hz": 1e6,
                    "frequency_stop_hz": 1e9, "frequency_points": 11,
                },
            }})
            self.assertEqual(result["data"]["domain"], domain)
            self.assertEqual(result["data"]["validation"]["contract"], "spike/openems-preflight/v1")
            self.assertFalse(result["data"]["validation"]["can_run"])

    def test_missing_analysis_is_explicit_failure(self):
        with self.assertRaisesRegex(RuntimeError, "analysis must be a JSON object"):
            self.extension.invoke("openems-si", {"design": openems_design().to_dict(), "parameters": {}})

    def test_worker_catalog_discovers_trusted_bundle(self):
        from python.spike_core.service import handle

        response = handle({"method": "list_extensions", "params": {}})
        self.assertTrue(response["ok"])
        suite = next(item for item in response["result"]["extensions"] if item["id"] == "spike.openems-suite")
        self.assertTrue(suite["trusted"])
        self.assertTrue(suite["ui"]["menu_bar"])

    def test_prepare_creates_authenticated_case_in_private_state(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "LOCALAPPDATA": directory, "SPIKE_STATE_HOME": str(Path(directory) / "state"),
        }):
            response = self.extension.invoke("openems-si", {"design": openems_design().to_dict(), "parameters": {
                "operation": "prepare", "analysis": {"net_names": ["RF"],
                    "frequency_start_hz": 1e6, "frequency_stop_hz": 1e9, "frequency_points": 11},
            }})
            case = response["data"]["case"]
            self.assertEqual(case["status"], "prepared_review_required")
            self.assertTrue(Path(case["case_dir"]).is_relative_to(Path(directory)))
            self.assertTrue((Path(case["case_dir"]) / "job.json").is_file())

    def test_single_excitation_conversion_preserves_values_and_missing_columns(self):
        from extensions.openems_suite.workspace_results import network_columns
        raw = {"frequency_hz":[1e6,2e6],"s_parameters":{
            "s12":{"real":[.2,.3],"imag":[-.1,.05]},
            "s22":{"real":[.4,.5],"imag":[.2,-.3]}}}
        ports = [{"excite":False},{"excite":True}]
        network = network_columns(raw, ports, 50)
        self.assertEqual(network["values"][0], [[None,[.2,-.1]],[None,[.4,.2]]])
        self.assertEqual(network["valid_mask"][0], [[False,True],[False,True]])
        self.assertEqual(network["missing_columns"],["P1"])
        raw["s_parameters"]["s11"] = raw["s_parameters"]["s12"]
        with self.assertRaisesRegex(ValueError,"excitation"):
            network_columns(raw,ports,50)

    def test_mesh_requires_actual_grid_and_execution_digest(self):
        from extensions.openems_suite.workspace_results import mesh_envelope
        from python.spike_core.extension_analysis_results import design_binding
        design = json.loads(json.dumps(openems_design().to_dict()))
        request = {"context":{"design":design,"design_binding":design_binding(design)}}
        raw = {"status":"setup_completed", "mesh":{"lines_mm":{"x":[0,1,2],"y":[0,2],"z":[-1,0]},
            "actual_grid":{"axis_cell_counts":{"x":2,"y":1,"z":1}}},
            "provenance":{"case_sha256":"a"*64,"generated_script_sha256":"b"*64}}
        mesh = mesh_envelope(request,raw)["data"]["mesh_result"]
        self.assertFalse(mesh["solved"])
        self.assertEqual(mesh["lines_mm"]["z"],[-1,0])
        raw["mesh"]["lines_mm"]["x"] = [0,2,1]
        with self.assertRaisesRegex(ValueError,"increasing"):
            mesh_envelope(request,raw)
        raw["mesh"].pop("lines_mm")
        with self.assertRaisesRegex(ValueError,"actual CSXCAD"):
            mesh_envelope(request,raw)

    def test_unavailable_mesh_and_solve_never_publish_numerical_result(self):
        from extensions.openems_suite.extension import execute
        from python.spike_core.extension_analysis_results import design_binding
        design = json.loads(json.dumps(openems_design().to_dict()))
        prepared = {"status":"prepared_review_required","case_dir":"unused"}
        for contribution in ("openems-mesh","openems-pi-solve","openems-si-solve","openems-em-solve"):
            with self.subTest(contribution=contribution), patch("extensions.openems_suite.extension.prepare_openems_case",return_value=prepared), patch("extensions.openems_suite.extension.run_openems_case",return_value={"status":"solver_unavailable"}) as run:
                response = execute({"contract":"spike/extension/v1","contribution_id":contribution,
                    "context":{"design":design,"design_binding":design_binding(design),"parameters":{"analysis":{"net_names":["RF"]}}}})
                self.assertEqual(response["status"],"failed")
                self.assertNotIn("mesh_result",response["data"])
                self.assertNotIn("analysis_result",response["data"])
                self.assertEqual(run.call_args.kwargs["setup_only"],contribution == "openems-mesh")

    def test_converted_network_is_sdk_bound_and_stale_design_rejected(self):
        from extensions.openems_suite.workspace_results import solve_envelope
        from python.spike_core.extension_analysis_results import admit_analysis_result, design_binding
        from python.spike_core.contracts import AnalysisSpec
        design = json.loads(json.dumps(openems_design().to_dict()))
        request = {"request_id":"conversion-unit-fixture","context":{"design":design,"design_binding":design_binding(design)}}
        spec = AnalysisSpec(mode="si", net_names=["RF"],frequency_start_hz=1e6,frequency_stop_hz=2e6,frequency_points=2,
            options={"ports":[{"excite":True}]})
        raw = {"status":"completed","frequency_hz":[1e6,2e6],"s_parameters":{"s11":{"real":[.2,.4],"imag":[.1,-.1]}},
            "mesh":{"lines_mm":{"x":[0,1],"y":[0,1],"z":[-1,0]},"actual_grid":{"axis_cell_counts":{"x":1,"y":1,"z":1}}},
            "provenance":{"case_sha256":"a"*64,"generated_script_sha256":"b"*64,"engine_version":"unit-fixture"}}
        result = solve_envelope(request,raw,spec,{})["data"]["analysis_result"]
        admitted = admit_analysis_result(result, design_binding(design), extension_id="spike.openems-suite")
        self.assertEqual(admitted["networks"]["s_parameters"]["values"][1][0][0],[.4,-.1])
        self.assertEqual(admitted["model_status"],"unvalidated")
        request["context"]["design_binding"]["digest_sha256"] = "c"*64
        with self.assertRaisesRegex(ValueError,"binding"):
            solve_envelope(request,raw,spec,{})


if __name__ == "__main__":
    unittest.main()
