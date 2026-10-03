# SPDX-License-Identifier: MIT
"""Representative requests from the native FreeCAD controls."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spike_freecad.simulation_forms import dc_spec, geometry_si_request, si_request, thermal_request  # noqa: E402


DESIGN = {"components": [{"reference": "U1"}], "pads": [
    {"component_pad": "U1.1", "net_name": "VCC", "at": [1, 2], "layer": "F.Cu"},
    {"component_pad": "U1.2", "net_name": "VCC", "at": [3, 4], "layer": "F.Cu"}]}


class SimulationFormTests(unittest.TestCase):
    def test_thermal_requires_explicit_power_and_preserves_assumptions(self):
        board = dict(ambient_temperature_c=25, conductivity_w_mk=20, thickness_mm=1.6,
                     convection_top_w_m2k=10, convection_bottom_w_m2k=10, grid_step_mm=4)
        with self.assertRaises(ValueError):
            thermal_request(DESIGN, board, [])
        value = thermal_request(DESIGN, board, [{"component_ref": "U1", "power_w": 1,
            "contact_size_mm": 8, "r_junction_case_k_w": 2, "r_case_board_k_w": 3}])
        self.assertEqual(value["components"][0]["power_w"], 1)

    def test_pi_contacts_are_on_the_selected_net(self):
        value = dc_spec(DESIGN, "VCC", "U1.1", "U1.2", 12, 1)
        self.assertEqual(value["sources"][0]["position_mm"], [1, 2])
        self.assertEqual(value["loads"][0]["position_mm"], [3, 4])
        with self.assertRaises(ValueError):
            dc_spec(DESIGN, "VCC", "U1.1", "U1.1", 12, 1)
        through_hole = {**DESIGN, "pads": [{**DESIGN["pads"][0], "layer": "*.Cu"}, DESIGN["pads"][1]]}
        self.assertNotIn("layer", dc_spec(through_hole, "VCC", "U1.1", "U1.2", 12, 1)["sources"][0])

    def test_si_is_explicit_rlgc_and_finite(self):
        values = dict(length_m=.05, resistance_ohm_per_m=5, inductance_h_per_m=2.5e-7,
                      capacitance_f_per_m=1e-10, loss_tangent=.015, frequency_stop_hz=8e9,
                      reference_impedance_ohm=50, high_v=1.8, rise_time_s=1e-10,
                      vil_v=.63, vih_v=1.17, bit_rate_hz=1e9, temperature_c=25)
        result = si_request(values)
        self.assertEqual(result["channel"]["kind"], "rlgc")
        with self.assertRaises(ValueError):
            si_request({**values, "length_m": float("nan")})

    def test_geometry_si_requires_linked_net_and_copper_layer(self):
        design = {"nets": [{"name": "SIG"}, {"name": "GND"}],
                  "layers": [{"name": "F.Cu"}, {"name": "F.Mask"}]}
        value = geometry_si_request(design, "SIG", "GND", "F.Cu", 1e9)
        self.assertEqual(value["frequencies_hz"][0], 0)
        self.assertEqual(value["frequencies_hz"][-1], 1e9)
        with self.assertRaises(ValueError):
            geometry_si_request(design, "SIG", "SIG", "F.Cu", 1e9)


if __name__ == "__main__":
    unittest.main()
