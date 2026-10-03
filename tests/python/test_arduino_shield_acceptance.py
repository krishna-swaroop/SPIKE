# SPDX-License-Identifier: Apache-2.0
"""Offline guards for the real Arduino acceptance source contract."""
import unittest

from scripts.build_arduino_shield_acceptance import EXPECTED_IMPORT_COUNTS, SOURCES, _frame, _transform_xy
from scripts.build_rpi_hat_acceptance import CM4_ARCHIVE_SHA256, HAT_BOARD_SHA256, HAT_COMMIT, _hat_frame


class ArduinoShieldAcceptanceSourceTests(unittest.TestCase):
    def test_sources_are_pinned_official_archives_with_explicit_license_members(self):
        self.assertEqual(set(SOURCES), {"uno", "shield"})
        for source in SOURCES.values():
            self.assertTrue(source["url"].startswith("https://docs.arduino.cc/static/"))
            self.assertRegex(source["sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(source["license_member"].endswith("License.txt"))
        self.assertEqual(SOURCES["uno"]["format"], "altium")
        self.assertEqual(SOURCES["shield"]["format"], "eagle")

    def test_expected_import_counts_cover_distinct_nontrivial_boards(self):
        self.assertEqual(EXPECTED_IMPORT_COUNTS["uno"], {"components": 85, "pads": 304, "nets": 64})
        self.assertEqual(EXPECTED_IMPORT_COUNTS["shield"], {"components": 47, "pads": 167, "nets": 35})
        self.assertNotEqual(EXPECTED_IMPORT_COUNTS["uno"], EXPECTED_IMPORT_COUNTS["shield"])

    def test_raspberry_pi_local_inputs_are_exactly_pinned(self):
        self.assertRegex(CM4_ARCHIVE_SHA256, r"^[0-9a-f]{64}$")
        self.assertRegex(HAT_BOARD_SHA256, r"^[0-9a-f]{64}$")
        self.assertRegex(HAT_COMMIT, r"^[0-9a-f]{40}$")

    def test_connector_derived_frames_align_multiple_physical_pins(self):
        arduino_shield = _frame(114.2111, 131.6736, 11.0)
        for uno, shield in (((152.3111, 129.1336), (38.1, -2.54)),
                            ((154.8511, 129.1336), (40.64, -2.54))):
            left, right = _transform_xy(_frame(), uno), _transform_xy(arduino_shield, shield)
            self.assertAlmostEqual(left[0], right[0], places=9)
            self.assertAlmostEqual(left[1], right[1], places=9)
            self.assertEqual(right[2], 11.0)
        for cm4, hat in (((87.37, 106.28), (113.13, 38.73)),
                         ((89.91, 108.82), (110.59, 41.27)),
                         ((92.45, 106.28), (108.05, 38.73))):
            actual = _transform_xy(_hat_frame(), hat)
            self.assertAlmostEqual(actual[0], cm4[0], places=9)
            self.assertAlmostEqual(actual[1], cm4[1], places=9)
            self.assertEqual(actual[2], 14.0)


if __name__ == "__main__":
    unittest.main()
