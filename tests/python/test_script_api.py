"""Occurrence-scoped API contract for the integrated Python workspace."""

from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from python.spike_core.script_debug import python_debug_command, python_debug_status, start_python_debug
from python.spike_core.script_runtime import run_python_script


def design(design_id: str, net_id: int) -> dict[str, object]:
    return {
        "contract": "spike/v1", "design_id": design_id, "name": "Shared design",
        "source_format": "test", "units": "mm",
        "layers": [{"name": "F.Cu"}], "nets": [{"id": net_id, "name": "SHARED"}],
        "tracks": [], "vias": [], "pads": [], "zones": [],
        "components": [{"id": f"U{net_id}", "reference": f"U{net_id}"}],
        "stackup": [], "issues": [], "metadata": {},
    }


def workspace() -> dict[str, object]:
    return {
        "boards": [
            {"id": "occ-a", "name": "Controller", "design_id": "design-a",
             "design": design("design-a", 1)},
            {"id": "occ-b", "name": "Controller", "design_id": "design-b",
             "design": design("design-b", 2)},
        ],
        "selected_board_id": "occ-a",
        "assembly": {"connector_links": [{"id": "link-1"}]},
    }


class ScriptApiRunTest(unittest.TestCase):
    def test_static_completion_catalog_matches_public_api(self) -> None:
        path = Path(__file__).resolve().parents[2] / "schemas" / "python-workspace-api-v1.json"
        catalog = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(catalog["contract"], "spike/python-workspace-api/v1")
        paths = [member["path"] for member in catalog["members"]]
        self.assertEqual(len(paths), len(set(paths)))
        self.assertTrue({"spike.boards.get", "spike.nets.get", "spike.analysis.run",
                         "spike.result_data.current", "spike.ui.select_net",
                         "spike.publish_result"}.issubset(paths))
        for member in catalog["members"]:
            self.assertTrue({"path", "kind", "signature", "description"}.issubset(member))

    def test_real_child_import_and_occurrence_scoped_queries(self) -> None:
        result = run_python_script({
            "workspace": workspace(),
            "results": {"contract": "spike/results-context/v1", "complete": False},
            "code": """import spike
print(spike is globals()['spike'])
print([item['id'] for item in spike.boards.list()])
print(spike.nets.get(1, board_id='occ-a')['name'])
print(spike.nets.get(2, board_id='occ-b')['name'])
print(spike.layers.get('F.Cu', board_id='occ-a')['name'])
print(spike.components.get('U2', board_id='occ-b')['reference'])
print(spike.assembly.connector_links()[0]['id'])
print(spike.result_data.current['complete'])
spike.ui.select_net('occ-b', 2)
spike.ui.focus_board('occ-a')
spike.ui.open_panel('connector_links')
""",
        })
        self.assertEqual(result["status"], "completed", result["stderr"])
        self.assertIn("True", result["stdout"])
        self.assertIn("['occ-a', 'occ-b']", result["stdout"])
        self.assertEqual(result["ui_actions"], [
            {"action": "select_net", "board_id": "occ-b", "net_id": 2},
            {"action": "focus_board", "board_id": "occ-a"},
            {"action": "open_panel", "panel": "connector_links"},
        ])

    def test_ambiguity_invalid_identity_and_action_admission(self) -> None:
        ambiguous = run_python_script({"workspace": workspace(),
            "code": "import spike\nspike.boards.get(name='Controller')\n"})
        self.assertEqual(ambiguous["status"], "failed")
        self.assertIn("Ambiguous board", ambiguous["stderr"])

        duplicate = workspace()
        duplicate["boards"][1]["id"] = "occ-a"  # type: ignore[index]
        with self.assertRaisesRegex(ValueError, "Duplicate workspace board occurrence ID"):
            run_python_script({"workspace": duplicate, "code": "pass"})

        for code, message in (
            ("spike.ui.focus_board('missing')", "Unknown board"),
            ("spike.ui.select_net('occ-a', 2)", "Unknown net"),
            ("spike.ui.open_panel('terminal')", "Unsupported SPIKE panel"),
            ("[spike.ui.open_panel('nets') for _ in range(65)]", "at most 64 UI actions"),
        ):
            result = run_python_script({"workspace": workspace(), "code": f"import spike\n{code}\n"})
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["ui_actions"], [])
            self.assertIn(message, result["stderr"])

        forged = run_python_script({"workspace": workspace(),
            "code": "import spike\nspike._ui_actions.append({'action':'execute','method':'health'})\n"})
        self.assertEqual(forged["status"], "failed")
        self.assertEqual(forged["ui_actions"], [])
        self.assertIsNone(forged.get("published_result"))
        self.assertIn("unsupported action", forged["stderr"])

    def test_null_assembly_and_unselected_workspace_remain_queryable_by_id(self) -> None:
        snapshot = workspace()
        snapshot["selected_board_id"] = None
        snapshot["assembly"] = None
        result = run_python_script({
            "workspace": snapshot,
            "code": """import spike
print(spike.boards.list())
print(spike.nets.get(2, board_id='occ-b')['name'])
print(spike.assembly.connector_links())
try:
    spike.nets.list()
except ValueError as exc:
    print(exc)
""",
        })
        self.assertEqual(result["status"], "completed", result["stderr"])
        self.assertIn("occ-a", result["stdout"])
        self.assertIn("SHARED", result["stdout"])
        self.assertIn("No workspace board is selected", result["stdout"])

        with_legacy_design = run_python_script({
            "workspace": snapshot, "design": design("design-a", 1),
            "code": "import spike\nprint(spike.design['design_id'])\nprint(spike.boards.get('occ-b')['id'])\n",
        })
        self.assertEqual(with_legacy_design["status"], "completed", with_legacy_design["stderr"])
        self.assertIn("design-a", with_legacy_design["stdout"])
        self.assertIn("occ-b", with_legacy_design["stdout"])

    def test_legacy_design_publish_contract_is_preserved(self) -> None:
        result = run_python_script({"design": design("legacy", 7),
            "code": "import spike\nspike.publish_scalar_field('voltage_v', "
                    "[{'x_mm':0,'y_mm':0,'value':1.25}])\n"})
        self.assertEqual(result["status"], "completed", result["stderr"])
        self.assertEqual(result["published_result"]["provenance"]["design_id"], "legacy")


class ScriptApiDebugParityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "SPIKE_WORKSPACE": self.temporary.name,
            "SPIKE_DEBUG_SESSION_ROOT": os.path.join(self.temporary.name, "sessions"),
        })
        self.environment.start()
        self.sessions: list[str] = []

    def tearDown(self) -> None:
        for session_id in self.sessions:
            try:
                state = python_debug_status({"session_id": session_id})
                if state["status"] in {"starting", "running", "paused"}:
                    python_debug_command({"session_id": session_id, "command": "stop"})
            except (OSError, ValueError):
                pass
        self.environment.stop()
        self.temporary.cleanup()

    def test_debug_uses_same_importable_module_and_ui_actions(self) -> None:
        state = start_python_debug({
            "workspace": workspace(), "filename": "api_debug.py", "timeout_seconds": 10,
            "code": "import spike\nprint(spike.boards.get()['id'])\n"
                    "spike.ui.select_net('occ-a',1)\nspike.ui.open_panel('results')\n",
        })
        session_id = str(state["session_id"])
        self.sessions.append(session_id)
        deadline = time.monotonic() + 5
        while state["status"] not in {"completed", "failed"} and time.monotonic() < deadline:
            time.sleep(0.025)
            state = python_debug_status({"session_id": session_id})
        self.assertEqual(state["status"], "completed", state.get("stderr"))
        self.assertIn("occ-a", state["stdout"])
        self.assertEqual(state["ui_actions"], [
            {"action": "select_net", "board_id": "occ-a", "net_id": 1},
            {"action": "open_panel", "panel": "results"},
        ])


if __name__ == "__main__":
    unittest.main()
