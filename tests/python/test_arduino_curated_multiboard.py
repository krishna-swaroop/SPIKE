# SPDX-License-Identifier: Apache-2.0
"""Independent numerical checks for the curated Arduino multiboard example."""
import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "examples/multiboard/arduino/acceptance-results.json"


class ArduinoCuratedMultiboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads(EVIDENCE.read_text(encoding="utf-8"))

    def test_pi_matches_ohms_law(self):
        pi = self.record["pi"]
        expected_current = pi["supply_v"] / (pi["load_ohm"] + pi["series_resistance_ohm"])
        self.assertAlmostEqual(abs(pi["supply_current_a"]), expected_current, places=11)
        self.assertAlmostEqual(pi["load_power_w"], expected_current**2 * pi["load_ohm"], places=11)
        self.assertLess(abs((pi["load_positive_v"] - pi["load_return_v"])
                            - expected_current * pi["load_ohm"]), 2e-11)

    def test_si_matches_complete_signal_and_return_network_at_every_frequency(self):
        si = self.record["si"]
        observed = zip(si["frequency_hz"], si["load_differential_real_v"],
                       si["load_differential_imaginary_v"])
        for frequency, real_v, imaginary_v in observed:
            # POWER0:6 returns through 0.01 ohm + 2 nH. The two 1 Mohm
            # power-bias elements and the other power-header pin form the
            # parallel 2 Mohm + identical-link path retained by the solver.
            return_link = complex(0.01, 2 * math.pi * frequency * 2e-9)
            return_impedance = 1 / (1 / return_link + 1 / (2_000_000 + return_link))
            signal_impedance = complex(0.02, 2 * math.pi * frequency * 5e-9)
            expected = si["source_ac_v"] * si["load_ohm"] / (
                si["load_ohm"] + signal_impedance + return_impedance)
            self.assertLess(abs(complex(real_v, imaginary_v) - expected), 3e-15)

    def test_thermal_conserves_supplied_power(self):
        thermal = self.record["thermal"]
        supplied = thermal["uno_power_w"] + thermal["shield_power_w"]
        self.assertAlmostEqual(thermal["total_power_w"], supplied, places=12)
        self.assertLess(abs(thermal["ambient_heat_flow_w"] - supplied), 2e-12)
        self.assertLess(abs(thermal["energy_balance_residual_w"]), 2e-12)
        self.assertLess(abs(thermal["radiation_closure_residual_w"]), 2e-12)
        self.assertGreater(thermal["shield_temperature_c"], thermal["uno_temperature_c"])
        self.assertGreater(thermal["uno_temperature_c"], thermal["ambient_c"])


if __name__ == "__main__":
    unittest.main()
