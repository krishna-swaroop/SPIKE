# SPDX-License-Identifier: Apache-2.0
"""Validate the mapping emitted by the native source dialog at the extension boundary."""
from pathlib import Path
import tempfile
import unittest

from python.spike_core.extensions import ExtensionRegistry


ROOT = Path(__file__).resolve().parents[2]


class NativeHarnessImportMappingTests(unittest.TestCase):
    def test_mapped_vendor_and_canonical_optional_fields_survive_process_import(self):
        registry = ExtensionRegistry()
        registry.discover([ROOT / "extensions"], trusted_roots=[ROOT / "extensions"])
        mapping = {key: key for key in (
            "wire_id", "from_pin", "to_connector", "to_pin", "net", "area_mm2",
            "resistance_ohm", "inductance_h", "color", "part_number",
        )}
        mapping.update(from_connector="Connector A", length_mm="Wire length")
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "vendor.csv"
            path.write_text(
                'wire_id,Connector A,from_pin,to_connector,to_pin,net,Wire length,area_mm2,resistance_ohm,inductance_h,color,part_number,Vendor note\n'
                'W1,J1,01,J2,A,VCC,1250,0.5,0.042,0.000001,red,PN-1,"Keep, this"\n',
                encoding="utf-8",
            )
            imported = registry.invoke("spike.harness", "harness-import", {
                "parameters": {"path": str(path), "delimiter": ",", "column_map": mapping},
            })["data"]
        wire = imported["wires"][0]
        self.assertEqual(wire["from"], {"connector": "J1", "pin": "01"})
        self.assertEqual(wire["length_mm"], 1250)
        self.assertEqual(wire["area_mm2"], 0.5)
        self.assertEqual(wire["electrical"], {"resistance_ohm": 0.042, "inductance_h": 1e-6})
        self.assertEqual([wire[key] for key in ("net", "color", "part_number")], ["VCC", "red", "PN-1"])
        self.assertEqual(wire["properties"]["source_row"]["Vendor note"], "Keep, this")
        self.assertEqual(imported["provenance"]["column_map"], mapping)


if __name__ == "__main__":
    unittest.main()
