# SPDX-License-Identifier: Apache-2.0
from pathlib import Path
import tempfile
import unittest
import zipfile

from python.spike_core.extensions import ExtensionRegistry
from python.spike_core.odb_source_inspection import inspect_odb_source


ROOT = Path(__file__).resolve().parents[2]
def matrix(*steps: str, layers: int = 2) -> str:
    records = [
        f"STEP {{\nCOL={index}\nNAME={name}\n}}\n"
        for index, name in enumerate(steps, 1)
    ]
    records.extend(
        f"LAYER {{\nROW={index}\nNAME=layer{index}\nTYPE=SIGNAL\n}}\n"
        for index in range(1, layers + 1)
    )
    return "".join(records)


def write_folder(parent: Path, text: str, *, root: str = "job") -> Path:
    source = parent / root
    target = source / "matrix" / "matrix"
    target.parent.mkdir(parents=True)
    target.write_text(text, encoding="utf-8")
    return source


class OdbSourceInspectionTests(unittest.TestCase):
    def test_single_step_folder_has_import_compatible_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = write_folder(Path(temporary), matrix("Main", layers=3))
            result = inspect_odb_source(source)
        self.assertEqual(result, {
            "contract": "spike/odb-source-inspection/v1",
            "steps": ["main"],
            "layer_count": 3,
            "default_step": "main",
        })

    def test_multiple_step_archive_has_no_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "board.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr(
                    "release/matrix/matrix",
                    matrix("Panel", "BOARD", layers=4),
                )
            result = inspect_odb_source(archive)
        self.assertEqual(result["steps"], ["panel", "board"])
        self.assertEqual(result["layer_count"], 4)
        self.assertNotIn("default_step", result)

    def test_invalid_missing_and_duplicate_matrix_or_steps_are_explicit(self):
        cases = {
            "missing matrix": (
                {"job/readme": "not ODB++"},
                "Expected one package root containing matrix/matrix; found 0",
            ),
            "duplicate matrix": (
                {
                    "one/matrix/matrix": matrix("a"),
                    "two/matrix/matrix": matrix("b"),
                },
                "Expected one package root containing matrix/matrix; found 2",
            ),
            "invalid matrix": (
                {"matrix/matrix": "STEP {\nNAME=board\n"},
                "Unterminated ODB\\+\\+ matrix block",
            ),
            "missing steps": (
                {"matrix/matrix": matrix(layers=1)},
                "does not declare any steps",
            ),
            "unnamed step": (
                {"matrix/matrix": "STEP {\nCOL=1\n}\n"},
                "STEP block is missing a NAME",
            ),
            "duplicate steps": (
                {"matrix/matrix": matrix("Board", "board")},
                "Duplicate ODB\\+\\+ step name",
            ),
        }
        for label, (files, message) in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                source = Path(temporary) / "job"
                for name, text in files.items():
                    target = source / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(text, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    inspect_odb_source(source)

    def test_invoke_extension_returns_inspection_as_result_data(self):
        registry = ExtensionRegistry()
        registry.discover(
            [ROOT / "extensions"],
            trusted_roots=[ROOT / "extensions"],
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = write_folder(root, matrix("Board"))
            result = registry.invoke(
                "spike.odb-import",
                "odb-inspect",
                {"source": {"path": str(source)}},
            )
        self.assertEqual(result["contract"], "spike/extension-result/v1")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["title"], "ODB++ source inspection")
        self.assertEqual(result["data"], {
            "contract": "spike/odb-source-inspection/v1",
            "steps": ["board"],
            "layer_count": 2,
            "default_step": "board",
        })


if __name__ == "__main__":
    unittest.main()
