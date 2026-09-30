# SPDX-License-Identifier: Apache-2.0
"""Coupled-conductor admission and result binding, without a physics oracle."""

from copy import deepcopy
import unittest

from extensions.emerge_suite.board_adapter import compile_board
from extensions.emerge_suite.extension import execute
from extensions.emerge_suite.normalize import network
from python.spike_core.extension_analysis_results import admit_analysis_result
from tests.python.test_emerge_suite_extension import board, parameters


def coupled_board():
    design = board()
    for pad in deepcopy(design["pads"]):
        pad["id"] += "B"
        pad["at"][1] = 1.5
        if pad["net_name"] == "RF":
            pad["net_name"] = "VICTIM"
        design["pads"].append(pad)
    design["tracks"].append({"id": "T2", "net_name": "VICTIM", "layer": "F.Cu",
                             "start": [0, 1.5], "end": [10, 1.5], "width": 0.4})
    return design


def coupled_parameters():
    params = parameters()
    for key in ("signal_pad_id", "return_pad_id", "receive_signal_pad_id", "receive_return_pad_id"):
        params.pop(key)
    params["additional_signal_nets"] = ["VICTIM"]
    params["port_pairs"] = [
        {"signal_net": net, "signal_pad_id": signal, "return_pad_id": ground}
        for net, signal, ground in (("RF", "P1", "G1"), ("RF", "P2", "G2"),
                                   ("VICTIM", "P1B", "G1B"), ("VICTIM", "P2B", "G2B"))]
    return params


def four_port_raw():
    return {"engine_version": "3.0.0a19", "air_margin_m": 0.05, "s_parameters": {
        "frequencies_hz": [1e9, 2e9], "ports": ["P1", "P2", "P3", "P4"],
        "reference_impedance_ohm": 50,
        "values": [[[[0.1 if i == j else 0.01, 0.02] for j in range(4)]
                    for i in range(4)] for _ in range(2)]}}


class EMergeMultiportTests(unittest.TestCase):
    def test_four_port_compilation_retains_both_conductors_and_mapping(self):
        case = compile_board(coupled_board(), coupled_parameters())
        self.assertEqual(case["modeled_nets"], ["RF", "VICTIM", "GND"])
        self.assertEqual(len(case["ports"]), 4)
        self.assertEqual([row["signal_net"] for row in case["port_mapping"]],
                         ["RF", "RF", "VICTIM", "VICTIM"])
        self.assertEqual(case["port_mapping"][3]["port"], "P4")
        self.assertTrue(any(p["net"] == "VICTIM" for p in case["polygons"]))
        self.assertEqual(len(compile_board(board(), parameters())["ports"]), 2)

    def test_parameters_fail_closed(self):
        mutations = [
            lambda p: p.update(additional_signal_nets="VICTIM"),
            lambda p: p.update(additional_signal_nets=["VICTIM", "VICTIM"]),
            lambda p: p.update(additional_signal_nets=["GND"]),
            lambda p: p.update(additional_signal_nets=["RF"]),
            lambda p: p.update(additional_signal_nets=["A", "B", "C", "D"]),
            lambda p: p.pop("port_pairs"),
            lambda p: p.update(port_pairs=None),
            lambda p: p.update(port_pairs=p["port_pairs"][:1]),
            lambda p: p.update(port_pairs=p["port_pairs"] * 3),
            lambda p: p["port_pairs"][0].update(signal_net="UNKNOWN"),
            lambda p: p.update(port_pairs=p["port_pairs"][:2]),
            lambda p: p["port_pairs"][1].update(signal_pad_id="P1"),
            lambda p: p["port_pairs"][0].update(signal_pad_id=""),
            lambda p: p["port_pairs"][0].update(extra="unexpected"),
            lambda p: p["port_pairs"][2].update(signal_pad_id="P1"),
            lambda p: p["port_pairs"][0].update(return_pad_id="P1B"),
        ]
        for mutation in mutations:
            params = coupled_parameters()
            mutation(params)
            with self.subTest(parameters=params), self.assertRaises(ValueError):
                compile_board(coupled_board(), params)

    def test_geometry_and_dc_are_rejected(self):
        design = coupled_board()
        design["pads"][5]["at"][0] += 0.2
        with self.assertRaisesRegex(ValueError, "align"):
            compile_board(design, coupled_parameters())
        design = coupled_board()
        design["pads"][5]["net_name"] = "OTHER_GROUND"
        with self.assertRaisesRegex(ValueError, "existing"):
            compile_board(design, coupled_parameters())
        params = coupled_parameters()
        params["frequency_start_hz"] = 0
        with self.assertRaisesRegex(ValueError, "start frequency"):
            compile_board(coupled_board(), params)

    def test_four_port_execution_admission_and_result_binding(self):
        request = {"contract": "spike/extension/v1", "request_id": "coupled-a",
                   "contribution_id": "emerge-si", "context": {
                       "design": coupled_board(), "parameters": coupled_parameters(),
                       "design_binding": {"design_id": "board-a", "digest_sha256": "a" * 64}}}
        def backend(case, **kwargs):
            self.assertFalse(kwargs["radiation_requested"])
            self.assertEqual(len(case["ports"]), 4)
            return four_port_raw()
        result = execute(request, backend=backend)["data"]["analysis_result"]
        admitted = admit_analysis_result(result, request["context"]["design_binding"],
                                         extension_id="spike.emerge-suite")
        self.assertEqual(admitted["model_status"], "unvalidated")
        self.assertEqual(len(result["summary"]["port_mapping"]), 4)
        self.assertEqual(result["provenance"]["port_mapping"], result["summary"]["port_mapping"])
        for change in (lambda raw: raw["s_parameters"]["ports"].reverse(),
                       lambda raw: raw["s_parameters"]["values"][0].pop()):
            raw = four_port_raw()
            change(raw)
            with self.assertRaises(ValueError):
                execute(request, backend=lambda *args, **kwargs: raw)
        raw = four_port_raw()["s_parameters"]
        raw["values"][0][2][1] = [float("nan"), 0]
        with self.assertRaises(ValueError):
            network(raw)


if __name__ == "__main__":
    unittest.main()
