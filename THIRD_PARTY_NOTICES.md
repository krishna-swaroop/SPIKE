# Third-party notices and example sources

SPIKE uses open-source libraries and can connect to separately installed tools. Their own license files govern those components. This page also records the sources of boards and images shown in SPIKE documentation.

## Software and integrations

| Project | How SPIKE uses it | Source and terms |
| --- | --- | --- |
| KiCad | PCB import and example board files | [KiCad project](https://www.kicad.org/); KiCad and board authors retain their own notices. |
| Tauri, React, Three.js, Lucide, and Plotly.js | Desktop interface, 3D view, icons, and plots | Versions are recorded in `app/package-lock.json` and `app/src-tauri/Cargo.lock`. Plotly.js is MIT-licensed; consult each package's included license. |
| NumPy, SciPy, PyVista, wxPython, nanobind, Matplotlib, mplcursors, ReportLab, Apache Arrow/PyArrow, jsonschema, and Eigen | Python worker, native kernels, visualization, and reports | Versions are recorded in the Python requirements and native build files. Consult each installed package's license. |
| Shapely and GEOS | Geometry handling | Shapely is BSD 3-Clause; its bundled GEOS library is identified under LGPL-2.1 in the Windows wheel metadata. |
| FreeCAD SPIKE Workbench | Optional geometry exchange | The workbench under `integrations/freecad/SPIKEWorkbench/` has its own MIT license. FreeCAD is a separate project. |
| Robert Fennis's EMerge | Optional antenna and EM solver used through `extensions/emerge_suite/` | EMerge is separately installed and retains its own terms; it is not included with SPIKE. |
| ngspice, openEMS/CSXCAD, and OpenFOAM | Optional circuit, EM, and airflow engines | These are separate projects and installations. See their own distributions for license details. |
| sparseLizard | Optional native adapter | `integrations/sparselizard-native/LICENSE` identifies the adapter as GPL-2.0-or-later; the upstream runtime has its own GPL notices. |

## Boards and documentation images

- **ESP32 example:** The `iot-esp-eth` board by uysan is included under CERN-OHL-P-2.0. Its source, license, and upstream revision are recorded in [examples/esp32/source/LICENSE.md](examples/esp32/source/LICENSE.md) and the [worked example](examples/esp32/README.md). Upstream reference images and measurements are labeled separately from SPIKE results.
- **Marble reference board:** Berkeley Lab's Marble v1.4.4 board and documentation are credited to the Regents of the University of California through Lawrence Berkeley National Laboratory. The upstream documentation states CERN OHL v1.2 and a U.S. Government rights notice. The board-documentation image and front-copper SVG in `app/public/help/` come from the pinned source recorded in [Help maintenance](docs/HELP_MAINTENANCE.md). SPIKE interface captures showing Marble are labeled as captures; the report preview says analysis was not run.

If a source or credit is missing, please [open an issue](https://github.com/wayri/SPIKE-Main/issues). Preserve the original license and attribution when reusing third-party material.
