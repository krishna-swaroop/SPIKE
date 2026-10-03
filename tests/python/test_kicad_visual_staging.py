# SPDX-License-Identifier: Apache-2.0
"""Undefined graphic staging preserves retained bytes and rejects electrical guesses."""

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from python.spike_core.kicad_visual_staging import stage_undefined_graphics
from python.spike_core.models import _kicad_failure_details, export_kicad_visual_bundle


LAYERS = '(layers (0 "F.Cu" signal) (17 "Dwgs.User" user "User.Drawings"))'
GRAPHIC = '(gr_line (start 1 2) (end 3 4) (layer "UNDEFINED") (uuid "keep-id"))'


class KiCadVisualStagingTests(unittest.TestCase):
    def test_stages_only_layer_atoms_and_preserves_source_bytes_and_model_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "part.step"
            model.write_bytes(b"STEP")
            original = ('(kicad_pcb\r\n' + LAYERS + GRAPHIC +
                        '(footprint "UNDEFINED" (layer "F.Cu") (at 9 8 90) '
                        '(fp_text user "UNDEFINED (layer \\"UNDEFINED\\")" (layer "UNDEFINED")) '
                        '(model "${KIPRJMOD}/part.step")))').encode()
            board = root / "source.kicad_pcb"
            board.write_bytes(original)
            out = root / "visuals"
            out.mkdir()
            staged, repairs = stage_undefined_graphics(board, out)
            expected = original.decode().replace('(layer "UNDEFINED")', '(layer "Dwgs.User")').replace(
                '${KIPRJMOD}/part.step', model.as_posix())
            self.assertEqual(staged.read_bytes(), expected.encode())
            self.assertEqual(board.read_bytes(), original)
            self.assertEqual(repairs[0]["object_count"], 2)
            self.assertEqual(repairs[0]["object_types"], {"gr_line": 1, "fp_text": 1})
            self.assertTrue(repairs[0]["visual_only"])

    def test_undefined_electrical_or_unknown_objects_fail_without_staging(self):
        objects = [
            '(segment (start 1 2) (end 3 4) (layer "UNDEFINED"))',
            '(zone (layer "UNDEFINED"))',
            '(footprint "X" (layer "UNDEFINED"))',
            '(footprint "X" (pad "1" smd rect (layers "UNDEFINED")))',
            '(gr_unknown (layer "UNDEFINED"))',
            '(gr_line (net 1) (layer "UNDEFINED"))',
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            board = root / "source.kicad_pcb"
            for obj in objects:
                with self.subTest(obj=obj):
                    source = ('(kicad_pcb ' + LAYERS + GRAPHIC + obj + ')').encode()
                    board.write_bytes(source)
                    with self.assertRaisesRegex(ValueError, "resolve its layer"):
                        stage_undefined_graphics(board, root)
                    self.assertEqual(board.read_bytes(), source)
                    self.assertEqual(len(list(root.iterdir())), 1)

    def test_missing_drawing_layer_is_not_invented(self):
        with tempfile.TemporaryDirectory() as directory:
            board = Path(directory) / "source.kicad_pcb"
            board.write_text('(kicad_pcb ' + GRAPHIC + ')')
            with self.assertRaisesRegex(ValueError, "no Dwgs.User"):
                stage_undefined_graphics(board, board.parent)

    def test_plain_text_undefined_is_not_a_repair(self):
        with tempfile.TemporaryDirectory() as directory:
            board = Path(directory) / "source.kicad_pcb"
            board.write_text('(kicad_pcb (gr_text "UNDEFINED" (layer "F.SilkS")))')
            self.assertEqual(stage_undefined_graphics(board, board.parent), (board, []))

    def test_board_and_batch_layout_export_use_same_repaired_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            board = root / "source.kicad_pcb"
            original = ('(kicad_pcb ' + LAYERS + GRAPHIC + ')').encode()
            board.write_bytes(original)
            commands = []

            def run(command, _timeout):
                commands.append(command)
                staged = Path(command[-1])
                self.assertNotEqual(staged, board)
                self.assertNotIn('(layer "UNDEFINED")', staged.read_text())
                output = Path(command[command.index("--output") + 1])
                if "svg" in command:
                    self.assertIn("--mode-multi", command)
                    for name in ("F_Cu", "User_Drawings"):
                        (output / f"{staged.stem}-{name}.svg").write_text('<svg viewBox="0 0 10 20"/>')
                else:
                    output.write_bytes(b"glTF" + bytes(24))
                return subprocess.CompletedProcess(command, 0, "", "")

            with patch("python.spike_core.models.kicad_scene_capabilities", return_value={"available": True, "path": "kicad-cli"}), \
                    patch("python.spike_core.models._run_kicad", side_effect=run):
                for stage in ("board", "layout"):
                    result = export_kicad_visual_bundle(board, root / stage, stage=stage)
                    self.assertEqual(result["status"], "ready_with_warnings")
                    self.assertEqual(result["quality"]["visual_source_repairs"][0]["object_count"], 1)
                self.assertEqual(len(commands), 2)
                self.assertEqual(board.read_bytes(), original)
                self.assertEqual(set(result["layout"]["layers"]), {"F.Cu", "Dwgs.User"})

    def test_failure_diagnostic_prioritizes_native_parse_error_and_is_bounded(self):
        failure = "Failed to load board: undefined layers. Open the board in the PCB Editor to resolve."
        process = subprocess.CompletedProcess([], 3, "", "registry warning\n" + failure + "\nnoise\n" * 30)
        self.assertEqual(_kicad_failure_details([process]), " Native diagnostic: " + failure)
        self.assertLessEqual(len(_kicad_failure_details([subprocess.CompletedProcess([], 3, "", "x" * 5000)])), 2020)
