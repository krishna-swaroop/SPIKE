# SPDX-License-Identifier: Apache-2.0
"""Internal model identity and external DesignIR persistence compatibility."""
import json
from pathlib import Path
import unittest

from python.spike_core.contracts import DesignIR
from python.spike_core.design_ir_v2 import DesignIRV2
from python.spike_core.design_ir_v2_schema import DESIGN_IR_V2_CONTRACT
from python.spike_core.designir_compat import from_designir, to_designir
from python.spike_core.spider import SpiDeR, SpiDeRV2, SPIDER_V2_CONTRACT


class SpiDeRCompatibilityTests(unittest.TestCase):
    def test_existing_imports_share_type_identity(self):
        self.assertIs(DesignIR, SpiDeR)
        self.assertIs(DesignIRV2, SpiDeRV2)
        self.assertEqual(DESIGN_IR_V2_CONTRACT, SPIDER_V2_CONTRACT)
        self.assertEqual(SpiDeR.__name__, "SpiDeR")
        self.assertEqual(SpiDeRV2.__name__, "SpiDeRV2")

    def test_saved_esp32_design_roundtrips_through_exchange(self):
        root = Path(__file__).resolve().parents[2]
        raw = json.loads((root / "examples/esp32/evidence/rf_surrogate_design.json").read_text())
        original = raw.get("design_ir", raw)
        model = from_designir(original)
        self.assertIsInstance(model, SpiDeR)
        self.assertEqual(model.design_id, original["design_id"])
        exported = to_designir(model)
        for key, value in original.items():
            self.assertEqual(exported[key], value, key)
        self.assertEqual(to_designir(model)["contract"], "spike/v1")
        self.assertEqual(len(model.pads), len(original["pads"]))
        self.assertEqual(len(model.stackup), len(original["stackup"]))

    def test_v2_exchange_preserves_canonical_identity(self):
        model = SpiDeRV2.from_v1(SpiDeR(design_id="sample", name="Sample"), source_digest="abc")
        payload = to_designir(model)
        self.assertEqual(payload["contract"], "spike/design-ir/v2")
        restored = from_designir(payload)
        self.assertIsInstance(restored, SpiDeRV2)
        self.assertEqual(restored.to_dict(), payload)

    def test_exchange_requires_supported_version(self):
        for payload in ({}, {"contract": "other/v1"}):
            with self.assertRaisesRegex(ValueError, "exchange contract"):
                from_designir(payload)


if __name__ == "__main__":
    unittest.main()
