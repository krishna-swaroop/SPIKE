# SPDX-License-Identifier: MIT
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from spike_freecad.result_series import extract_series


class ResultSeriesTests(unittest.TestCase):
    def test_si_waveform(self):
        result = {"time_domain": {"receivers": [{"port": 2, "waveform": [
            {"time_s": 0, "voltage_v": 0}, {"time_s": 1e-9, "voltage_v": 1.2}]}]}}
        curves = extract_series(result)
        self.assertEqual(len(curves), 1)
        self.assertEqual(curves[0]["points"], [(0.0, 0.0), (1e-9, 1.2)])

    def test_mna_node_traces(self):
        result = {"data": {"time_s": [0, 1, 2],
                           "node_voltage_v": {"out": [0, 1, 2]}}}
        curves = extract_series(result)
        self.assertEqual(len(curves), 1)
        self.assertIn("out", curves[0]["name"])
        self.assertEqual(curves[0]["y_label"], "node_voltage_v")

    def test_no_invented_traces(self):
        self.assertEqual(extract_series({"screening": {"recommended_nets": []}}), [])
