# SPDX-License-Identifier: Apache-2.0
"""Independent numerical checks used by the curated Raspberry Pi assembly."""
import copy
import math
import unittest

from scripts.build_rpi_hat_acceptance import _acceptance


def fixture():
    frequencies = [1e3, 1e7]
    signal = {"real": [], "imaginary": []}
    ground = {"real": [0.0, 0.0], "imaginary": [0.0, 0.0]}
    for frequency in frequencies:
        omega = 2 * math.pi * frequency
        signal_path = complex(.025, omega * 6e-9)
        ground_path = complex(.012, omega * 3e-9)
        bias_return = complex(2e6 + .012, omega * 3e-9)
        return_path = ground_path * bias_return / (ground_path + bias_return)
        value = 4700 / (4700 + signal_path + return_path)
        signal["real"].append(value.real); signal["imaginary"].append(value.imag)
    power = (5 / (12.5 + .012 + .012))**2 * 12.5
    return {
        "pi": {"element_map": {"sailor-hat": {"hat-load": "load"}},
               "native_result": {"data": {"element_power_w": {"load": power}}}},
        "si": {"node_map": {"sailor-hat": {"J501:3": "signal", "J501:6": "return"}},
               "native_result": {"data": {"frequency_hz": frequencies,
                   "node_voltage_v": {"signal": signal, "return": ground}}}},
        "thermal": {"summary": {"energy_balance_residual_w": 1e-12}},
    }


class RaspberryPiHatAcceptanceTests(unittest.TestCase):
    def test_independent_pi_si_thermal_oracles_pass(self):
        evidence = _acceptance(fixture())
        self.assertTrue(evidence["passed"])
        self.assertLess(evidence["si"]["max_complex_voltage_error_v"], 1e-14)

    def test_si_regression_fails_closed(self):
        results = copy.deepcopy(fixture())
        results["si"]["native_result"]["data"]["node_voltage_v"]["signal"]["real"][1] -= .01
        with self.assertRaisesRegex(ValueError, "numerical acceptance failed"):
            _acceptance(results)


if __name__ == "__main__":
    unittest.main()
