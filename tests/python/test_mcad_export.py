"""MCAD export contracts, source-loss gates and real-kernel exchange checks."""
import base64
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

from python.spike_core.mcad_export import export_assembly
from python.spike_core.mcad_export_contract import IDENTITY, validate_assembly
from python.spike_core.mcad_export_design import assembly_from_context
from python.spike_core.contracts import SpiDeR
from python.spike_core.spider_v2 import AssemblyIRV1, BoardInstance, SpiDeRV2
from python.spike_core.spider_v2_schema import CoordinateFrame


def ring(points, role="outer"):
    return {"role": role, "start_mm": points[0], "segments": [{"kind": "line", "end_mm": p} for p in [*points[1:], points[0]]]}


def assembly_fixture():
    moved = IDENTITY.copy()
    moved[3], moved[7], moved[11] = 12., 23., 5.
    rotated = [0., -1., 0., 4., 1., 0., 0., 3., 0., 0., 1., 2., 0., 0., 0., 1.]
    return {"contract": "spike/mcad-assembly/v1", "id": "fixture", "name": "ECAD MCAD exchange", "units": "mm",
        "materials": [{"id": "fr4", "name": "FR-4", "properties": {"relative_permittivity": 4.2, "vendor": {"grade": "test"}}},
                      {"id": "metal", "name": "Copper", "properties": {"density_kg_per_m3": 8960}}],
        "objects": [
            {"id": "board", "name": "Main board", "kind": "assembly", "transform": moved},
            {"id": "substrate", "name": "Core", "kind": "dielectric", "parent_id": "board", "material_id": "fr4",
             "geometry": {"type": "extrusion", "height_mm": 1.6, "rings": [ring([[0,0],[20,0],[20,10],[0,10]]), ring([[1,1],[2,1],[2,2],[1,2]], "cutout")]}},
            {"id": "cells", "name": "Cells", "kind": "assembly", "parent_id": "board", "transform": rotated},
            {"id": "cell:1", "name": "Repeated cell", "kind": "cell", "parent_id": "cells", "material_id": "metal",
             "geometry": {"type": "box", "size_mm": [1,2,3]}, "properties": {"reference": "U1", "vendor_properties": [{"name":"x","value":1},{"name":"x","value":2}]}},
            {"id": "cell:2", "name": "Repeated cell", "kind": "cell", "parent_id": "board",
             "geometry": {"type": "cylinder", "radius_mm": 0.5, "height_mm": 3}},
            {"id": "wire:1", "name": "Harness wire", "kind": "harness", "material_id": "metal",
             "geometry": {"type": "route", "radius_mm": 0.25, "points_mm": [[0,0,0],[4,0,0],[4,3,2]]}, "properties": {"net": "VCC", "connection": "J1.01 -> J2.02"}}
        ]}


def retained_multiboard_fixture():
    design = SpiDeRV2.from_v1(SpiDeR(
        design_id="shared-design", name="Shared source board", source_format="neutral",
        stackup=[{"name": "Core", "type": "dielectric", "thickness_mm": 1.6, "material": "FR-4"}],
        components=[{"reference": "U1", "position": [2.0, 3.0], "rotation": 90.0,
                     "model_path": "retained-controller.step"}],
        metadata={"source_sha256": "a" * 64,
                  "board_outline_rings": [ring([[0, 0], [10, 0], [10, 5], [0, 5]])]},
    )).to_dict()
    translated = IDENTITY.copy()
    translated[3], translated[7], translated[11] = 30.0, 4.0, 2.0
    rotated = [0.0, -1.0, 0.0, 12.0, 1.0, 0.0, 0.0, 7.0,
               0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    assembly = AssemblyIRV1(assembly_id="repeated-board-assembly", name="Repeated boards", boards=[
        BoardInstance(id="controller-a", name="Controller A", design_id=design["design_id"],
                      frame=CoordinateFrame(frame_id="controller-a-frame", parent_frame_id="assembly", transform=tuple(translated))),
        BoardInstance(id="controller-b", name="Controller B", design_id=design["design_id"],
                      frame=CoordinateFrame(frame_id="controller-b-frame", parent_frame_id="assembly", transform=tuple(rotated))),
    ]).to_dict()
    retained = {"contract": "spike/assembly-designs/v1", "active_design_id": design["design_id"], "designs": [design]}
    return design, assembly, retained


class McadContractTests(unittest.TestCase):
    def test_multiboard_projection_preserves_repeated_occurrences_placements_and_removal(self):
        design, assembly_ir, retained = retained_multiboard_fixture()
        context = {"design": design, "project": {"assembly_ir": assembly_ir, "assembly_designs": retained},
                   "parameters": {"allow_partial": True}}
        before = copy.deepcopy(context)
        projected = assembly_from_context(context)
        self.assertEqual(context, before)
        rows = {row["id"]: row for row in projected["objects"]}
        self.assertEqual(rows["controller-a"]["transform"][3:12:4], [30.0, 4.0, 2.0])
        self.assertEqual(rows["controller-b"]["transform"], list(assembly_ir["boards"][1]["frame"]["transform"]))
        self.assertEqual(rows["controller-a/layer:0"]["parent_id"], "controller-a")
        self.assertEqual(rows["controller-b/layer:0"]["parent_id"], "controller-b")
        occurrences = projected["properties"]["component_occurrences"]
        component_id = design["components"][0]["id"]
        self.assertEqual({row["id"] for row in occurrences},
                         {f"controller-a/component:{component_id}", f"controller-b/component:{component_id}"})
        self.assertTrue(all(row["model_ids"] for row in occurrences))
        self.assertEqual(len(projected["properties"]["retained_design_models"][design["design_id"]]), 1)
        self.assertEqual(len(projected["properties"]["retained_design_components"][design["design_id"]]), 1)
        self.assertEqual(projected["provenance"]["board_occurrence_ids"], ["controller-a", "controller-b"])

        active_fallback = assembly_from_context({"design": design, "project": {"assembly_ir": assembly_ir},
                                                 "parameters": {"allow_partial": True}})
        self.assertEqual(active_fallback["provenance"]["board_occurrence_ids"],
                         ["controller-a", "controller-b"])

        removed = copy.deepcopy(context)
        removed["project"]["assembly_ir"]["boards"].pop()
        reprojected = assembly_from_context(removed)
        self.assertNotIn("controller-b", {row["id"] for row in reprojected["objects"]})
        self.assertNotIn(f"controller-b/component:{component_id}",
                         {row["id"] for row in reprojected["properties"]["component_occurrences"]})

    def test_multiboard_projection_requires_every_retained_design(self):
        design, assembly_ir, _ = retained_multiboard_fixture()
        other = copy.deepcopy(assembly_ir)
        other["boards"][1]["design_id"] = "missing-design"
        with self.assertRaisesRegex(ValueError, "missing retained SpiDeR designs: missing-design"):
            assembly_from_context({"design": design, "project": {"assembly_ir": other},
                                   "parameters": {"allow_partial": True}})

    def test_isolated_extension_plan_receives_complete_project_assembly(self):
        from python.spike_core.extensions import ExtensionRegistry
        design, assembly_ir, retained = retained_multiboard_fixture()
        root = Path(__file__).resolve().parents[2] / "extensions"
        registry = ExtensionRegistry()
        registry.discover([root], trusted_roots=[root])
        result = registry.invoke("spike.mcad", "mcad-plan", {
            "design": design,
            "project": {"name": "Repeated boards", "assembly_ir": assembly_ir, "assembly_designs": retained},
            "parameters": {},
        })
        self.assertEqual(result["data"]["provenance"]["board_occurrence_ids"],
                         ["controller-a", "controller-b"])
        self.assertEqual({row["id"] for row in result["data"]["objects"] if row["kind"] == "assembly"},
                         {"controller-a", "controller-b"})

    def test_identities_materials_and_source_are_not_mutated(self):
        a = assembly_fixture(); before = copy.deepcopy(a)
        result = validate_assembly(a)
        self.assertEqual(a, before)
        self.assertEqual(result["materials"], a["materials"])
        self.assertEqual(result["objects"][3]["properties"], a["objects"][3]["properties"])

    def test_invalid_identity_hierarchy_geometry_and_units_fail(self):
        mutations = [lambda a: a["objects"].append(copy.deepcopy(a["objects"][0])),
            lambda a: a["objects"][0].update(parent_id="cells"),
            lambda a: a["objects"][1].update(material_id="missing"),
            lambda a: a["objects"][1].update(parent_id="cell:1"),
            lambda a: a.update(units="inch"),
            lambda a: a["objects"][2]["transform"].__setitem__(0, 2),
            lambda a: a["objects"][0]["transform"].__setitem__(0, -1),
            lambda a: a["objects"][3]["geometry"]["size_mm"].__setitem__(0, float("nan")),
            lambda a: a["objects"][1]["geometry"]["rings"][0]["segments"].pop(),
            lambda a: a["objects"][5]["geometry"]["points_mm"].__setitem__(1, [0,0,0])]
        for change in mutations:
            with self.subTest(change=change):
                a = assembly_fixture(); change(a)
                with self.assertRaises(ValueError): validate_assembly(a)

    def test_budget_checked_before_kernel(self):
        with patch("python.spike_core.mcad_export_contract.MAX_BYTES", 10), patch("python.spike_core.mcad_export._freecad_path") as kernel:
            with self.assertRaisesRegex(ValueError, "64 MiB"): export_assembly(assembly_fixture())
            kernel.assert_not_called()

    def test_bad_embedded_step_digest_fails(self):
        a = assembly_fixture()
        a["objects"][3]["geometry"] = {"type": "step", "data_base64": "@@@", "sha256": "0"*64}
        with self.assertRaisesRegex(ValueError, "base64"): validate_assembly(a)

    def test_harness_routes_need_explicit_radius_and_frame(self):
        h = {"contract":"spike/harness/v1","id":"h","name":"Cable","connectors":[{"id":"J1","pins":[{"id":"01"}]},{"id":"J2","pins":[{"id":"02"}]}],
             "wires":[{"id":"w","from":{"connector":"J1","pin":"01"},"to":{"connector":"J2","pin":"02"},"route_id":"r","area_mm2":0.2}],
             "routes":[{"id":"r","points_mm":[[0,0,0],[10,0,0]],"frame_id":"board-a"}]}
        p = {"allow_partial":True, "wire_radius_mm":{"w":0.5}}
        with self.assertRaisesRegex(ValueError,"frame"): assembly_from_context({"harness":h,"parameters":p})
        p["route_frames"] = {"board-a":IDENTITY.copy()}
        a = assembly_from_context({"harness":h,"parameters":p})
        self.assertEqual(a["objects"][1]["geometry"]["radius_mm"],0.5)
        self.assertEqual(a["properties"]["harness_document"]["wires"][0]["from"]["pin"],"01")

    def test_source_omissions_require_explicit_partial_export(self):
        d = {"contract": "spike/v1", "name": "PCB", "metadata": {"board_outline_rings": [ring([[0,0],[10,0],[10,5],[0,5]])]},
             "stackup": [{"name":"F.Cu", "type":"copper", "thickness":0.035},{"name":"core", "type":"dielectric", "thickness":1.53, "material":"FR4"}],
             "components":[{"reference":"U1","properties":{"vendor":"test"}}]}
        with self.assertRaisesRegex(ValueError, "incomplete"): assembly_from_context({"design":d})
        a = assembly_from_context({"design":d,"parameters":{"allow_partial":True}})
        self.assertEqual(a["objects"][1]["geometry"]["z_mm"], 0.035)
        self.assertEqual(a["properties"]["component_inventory"], d["components"])
        self.assertEqual({i["code"] for i in a["diagnostics"]}, {"LAYER_GEOMETRY_OMITTED","COMPONENT_GEOMETRY_REQUIRED"})
        d["metadata"] = {"board_bounds_mm": [0,0,10,5]}
        with self.assertRaisesRegex(ValueError, "outline"): assembly_from_context({"design":d,"parameters":{"allow_partial":True}})

    def test_adapter_forwards_cancellation_and_fixed_limits(self):
        event = threading.Event(); event.set()
        with patch("python.spike_core.mcad_export._freecad_path", return_value=Path("FreeCADCmd.exe")), patch("python.spike_core.mcad_export.run_adapter_process", side_effect=RuntimeError("cancelled")) as run:
            with self.assertRaisesRegex(RuntimeError,"cancelled"): export_assembly(assembly_fixture(), cancellation_event=event)
            self.assertIs(run.call_args.kwargs["cancellation_event"], event)
            self.assertEqual(run.call_args.kwargs["timeout_s"], 300)
            self.assertEqual(run.call_args.kwargs["memory_limit_mb"], 4096)


class McadKernelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from python.spike_core.dependencies import dependency_status
        if not any(d["id"] == "freecad" and d["status"] == "ready" for d in dependency_status()["dependencies"]):
            raise unittest.SkipTest("Optional FreeCAD runtime unavailable")

    def test_real_nested_assembly_step_fcstd_brep_and_metadata(self):
        a = assembly_fixture()
        result = export_assembly(a)
        manifest = result["manifest"]
        self.assertEqual(manifest["materials"], a["materials"])
        bodies = {o["id"]:o for o in manifest["objects"] if o["kind"] != "assembly"}
        self.assertEqual(len(bodies), 4)
        self.assertAlmostEqual(bodies["substrate"]["volume_mm3"], 199*1.6, places=6)
        self.assertEqual(bodies["cell:1"]["parent_id"], "cells")
        for measured, expected in zip(bodies["cell:1"]["bounds_mm"], [14,26,7,16,27,10]):
            self.assertAlmostEqual(measured,expected,places=6)
        self.assertTrue(all(o["step_roundtrip"] == "passed" for o in bodies.values()))
        archive_bytes = base64.b64decode(result["artifacts"][1]["data"])
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            self.assertIn("assembly.FCStd", archive.namelist())
            self.assertEqual(len([n for n in archive.namelist() if n.endswith(".brep")]),4)
            for artifact in manifest["artifacts"]:
                self.assertEqual(hashlib.sha256(archive.read(artifact["file"])).hexdigest(), artifact["sha256"])
            source = json.loads(archive.read("assembly.spike-mcad.json"))
            self.assertEqual(source["objects"][3]["properties"], a["objects"][3]["properties"])

    def test_repeated_board_occurrences_reach_every_mechanical_artifact(self):
        design, assembly_ir, retained = retained_multiboard_fixture()
        projected = assembly_from_context({
            "design": design,
            "project": {"assembly_ir": assembly_ir, "assembly_designs": retained},
            "parameters": {"allow_partial": True},
        })
        result = export_assembly(projected)
        expected_ids = {row["id"] for row in projected["objects"]}
        self.assertEqual({row["id"] for row in result["manifest"]["objects"]}, expected_ids)
        self.assertEqual(result["manifest"]["provenance"]["board_occurrence_ids"],
                         ["controller-a", "controller-b"])
        archive_bytes = base64.b64decode(result["artifacts"][1]["data"])
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            exported_input = json.loads(archive.read("assembly.spike-mcad.json"))
            self.assertEqual({row["id"] for row in exported_input["objects"]}, expected_ids)
            breps = {row["brep_file"] for row in result["manifest"]["objects"] if row["kind"] != "assembly"}
            self.assertEqual(breps, {name for name in archive.namelist() if name.endswith(".brep")})
            self.assertIn("assembly.step", archive.namelist())
            self.assertIn("assembly.FCStd", archive.namelist())
        bodies = {row["id"]: row for row in result["manifest"]["objects"] if row["kind"] != "assembly"}
        self.assertEqual(bodies["controller-a/layer:0"]["step_roundtrip"], "passed")
        self.assertEqual(bodies["controller-b/layer:0"]["step_roundtrip"], "passed")
        self.assertEqual(bodies["controller-a/layer:0"]["bounds_mm"][:3], [30.0, 4.0, 2.0])
        for measured, expected in zip(bodies["controller-b/layer:0"]["bounds_mm"], [7.0, 7.0, 1.0, 12.0, 17.0, 2.6]):
            self.assertAlmostEqual(measured, expected, places=6)

    def test_invalid_cutout_is_rejected_by_kernel(self):
        a = assembly_fixture()
        a["objects"][1]["geometry"]["rings"][1] = ring([[30,30],[31,30],[31,31],[30,31]],"cutout")
        with self.assertRaisesRegex(RuntimeError,"Cutout must be wholly inside"): export_assembly(a)

    def test_exact_arc_and_embedded_step_multi_solid_instance(self):
        a = assembly_fixture()
        first = export_assembly(a)
        payload = base64.b64decode(first["artifacts"][0]["data"])
        place = IDENTITY.copy(); place[3] = 30
        arc_ring = {"role":"outer", "start_mm":[1,0], "segments":[{"kind":"arc","mid_mm":[0,1],"end_mm":[-1,0]},{"kind":"arc","mid_mm":[0,-1],"end_mm":[1,0]}]}
        b = {"contract":"spike/mcad-assembly/v1","id":"embedded","name":"Placed MCAD source","units":"mm","objects":[
            {"id":"step-part","name":"Source STEP solids","kind":"component","transform":place,
             "geometry":{"type":"step","data_base64":base64.b64encode(payload).decode(),"sha256":hashlib.sha256(payload).hexdigest()}},
            {"id":"arc","name":"Exact round material","kind":"dielectric","geometry":{"type":"extrusion","rings":[arc_ring],"height_mm":2}}]}
        result = export_assembly(b)
        records = {o['id']:o for o in result['manifest']['objects']}
        self.assertEqual(records['step-part']['solid_count'],4)
        self.assertAlmostEqual(records['arc']['volume_mm3'],math.pi*2,places=6)
        self.assertAlmostEqual(records['step-part']['bounds_mm'][0],30,places=6)
        b['objects'][0]['geometry']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError,'digest'): validate_assembly(b)

    def test_isolated_extension_and_permission_gate(self):
        from python.spike_core.extensions import ExtensionRegistry
        root = Path(__file__).resolve().parents[2] / 'extensions'
        registry = ExtensionRegistry(); registry.discover([root],trusted_roots=[root])
        result = registry.invoke('spike.mcad','mcad-export',{'parameters':{'assembly':assembly_fixture()}})
        self.assertEqual(result['data']['contract'],'spike/mcad-export/v1')
        with self.assertRaises(PermissionError):
            registry.invoke('spike.mcad','mcad-export',{'source':{'path':'unauthorized'},'parameters':{'assembly':assembly_fixture()}})

    def test_real_cancellation_releases_kernel(self):
        event = threading.Event(); event.set()
        with self.assertRaisesRegex(RuntimeError,"cancelled"): export_assembly(assembly_fixture(), cancellation_event=event)


if __name__ == "__main__": unittest.main()
