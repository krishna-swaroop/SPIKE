# Visual asset provenance

| Asset | Source and owner | Use and redistribution check |
| --- | --- | --- |
| `images/workflow.svg` | Original diagram authored for the SPIKE FreeCAD workbench, 2026-09-28; SPIKE contributors. | MIT workbench documentation asset. |
| `../Resources/icons/*.svg` | Original vector toolbar and tab icons authored for the SPIKE FreeCAD workbench, 2026-09-28; SPIKE contributors. | MIT workbench UI assets. |
| `images/thermal-field-map.png` | Generated from the exact 3024 samples returned by SPIKE's board thermal worker for the demo board, 2026-09-28; chart authored by SPIKE contributors with matplotlib. | User-supplied illustrative Q1 loss and board properties, using three imported copper pad contacts; result `completed approximate`. The plot is visual evidence of sample projection, not solver qualification. |
| `images/pi-mesh-preview.png` | Generated from the 850 selected-net copper cells returned by SPIKE `preview_mesh` for the demo board's 12V net, 2026-09-28; chart authored by SPIKE contributors with matplotlib. | Geometry preview and quality data, not a solved field or convergence proof. |
| `images/linked-kicad-board.jpg` | Direct local screen capture of the same FreeCAD 1.1.3 installation and SPIKE demo board, 2026-09-28; captured by SPIKE contributors. | Same review as above. The point markers are reference geometry. |
| `images/detailed-board-copper.jpg` | Direct local screen capture of KiCad 10 STEP exported from the SPIKE demo PCB and imported in FreeCAD 1.1.3, 2026-09-28; captured by SPIKE contributors. | Review demo-board provenance and FreeCAD UI redistribution terms before public release. STEP is a geometry preview, not a physics mesh. |
| `images/detailed-board-3d.jpg` | Direct local screen capture of available demo-board component models imported in FreeCAD 1.1.3, 2026-09-28; captured by SPIKE contributors. | Some footprint models were unresolved; review model and screenshot redistribution rights before public release. |
| `images/solver-suite-board-ui.png`, `images/solver-suite-simulate-ui.png`, `images/solver-suite-help-ui.png` | Offscreen Qt 6 renders of the SPIKE FreeCAD workbench source using the FreeCAD 1.1 bundled Python and Segoe UI, 2026-09-28; SPIKE contributors. | UI documentation renders, not a claim that a KiCad board or solver was active in those captures. |

No screenshot or diagram grants a license to the FreeCAD executable, SPIKE worker, KiCad, or third-party models. In a standalone repository, retain this record and check the source repository's `THIRD_PARTY_NOTICES.md` and `CONTRIBUTING.md` before publishing assets.
