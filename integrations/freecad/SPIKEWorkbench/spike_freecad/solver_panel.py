# SPDX-License-Identifier: MIT
"""FreeCAD panel for linked KiCad data and asynchronous SPIKE worker calls."""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
from pathlib import Path

import FreeCAD as App
import FreeCADGui as Gui
import Part

try:
    from PySide import QtCore, QtGui, QtWidgets
except ImportError:
    try:
        from PySide6 import QtCore, QtGui, QtWidgets
    except ImportError:
        from PySide import QtCore, QtGui
        QtWidgets = QtGui

from .solver_link import board_bounds, component_records, freecad_xy, request_line, source_digest, validate_runtime
from .result_view import available_fields, clear_overlay, probe_nearest, project_samples, render_overlay, unwrap_result
from .board_step import (apply_step_to_document, build_step_export_arguments,
                         discover_kicad_cli, validate_step_artifact)
from .constants import ICON_ROOT
from .result_series import extract_series
from .simulation_forms import (dc_spec, geometry_si_request, pad_label, pads_for_net,
                               si_request, thermal_request)
from .mesh_view import (clear_mesh_preview, render_pi_mesh, render_thermal_grid,
                        thermal_grid)
from .help_view import show_help


_PANEL = None
_MAX_RESPONSE = 64 * 1024 * 1024
_WORKER_METHODS = (
    "run_board_thermal", "run_component_thermal", "validate_thermal",
    "estimate_thermal", "plan_thermal_field_job", "execute_thermal_field_job",
    "prepare_thermal_case", "run_thermal_case", "run_multiregion_thermal_case",
    "si_workflow_catalog", "run_si_workflow", "run_si_uniform_channel",
    "run_si_protocol_test_suite", "emi_preflight", "emi_screen",
    "run_native_mna", "run_owned_spice_workspace", "run_converter_study",
    "run_field_circuit_cosimulation", "run_hybrid_cosimulation",
    "prepare_openems_case", "run_openems_case", "prepare_sparselizard_case",
    "run_sparselizard_case", "mesh_convergence", "run_analysis",
    "capabilities", "list_external_engines", "solver_manager",
)


class _TraceDialog(QtWidgets.QDialog):
    def __init__(self, series, parent=None):
        super().__init__(parent)
        self.setWindowTitle("SPIKE result traces and probe")
        self.resize(840, 560)
        self._series = series
        layout = QtWidgets.QVBoxLayout(self)
        self.selector = QtWidgets.QComboBox()
        self.selector.addItems([item["name"] for item in series])
        self.selector.currentIndexChanged.connect(self._draw)
        layout.addWidget(self.selector)
        self.scene = QtWidgets.QGraphicsScene(self)
        self.view = QtWidgets.QGraphicsView(self.scene)
        layout.addWidget(self.view)
        row = QtWidgets.QHBoxLayout()
        self.x = QtWidgets.QLineEdit()
        self.x.setPlaceholderText("X coordinate in plotted units")
        row.addWidget(self.x)
        button = QtWidgets.QPushButton("Probe trace")
        button.clicked.connect(self._probe)
        row.addWidget(button)
        self.readout = QtWidgets.QLabel("")
        row.addWidget(self.readout)
        layout.addLayout(row)
        self._draw()

    def _draw(self, *_):
        self.scene.clear()
        record = self._series[self.selector.currentIndex()]
        points = record["points"]
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
        xrange = xmax - xmin or 1.0
        yrange = ymax - ymin or 1.0
        left, top, width, height = 75, 30, 700, 400
        axis = QtGui.QPen(QtGui.QColor("#8495a8"))
        trace = QtGui.QPen(QtGui.QColor("#23a9d1"))
        trace.setWidth(2)
        self.scene.addLine(left, top, left, top + height, axis)
        self.scene.addLine(left, top + height, left + width, top + height, axis)
        mapped = [(left + (x - xmin) / xrange * width,
                   top + height - (y - ymin) / yrange * height) for x, y in points]
        for first, second in zip(mapped, mapped[1:]):
            self.scene.addLine(first[0], first[1], second[0], second[1], trace)
        self.scene.addText(f"{ymax:.5g}").setPos(2, top - 9)
        self.scene.addText(f"{ymin:.5g}").setPos(2, top + height - 15)
        self.scene.addText(f"{xmin:.5g}").setPos(left, top + height + 5)
        self.scene.addText(f"{xmax:.5g}").setPos(left + width - 80, top + height + 5)
        self.scene.addText(f"{record['y_label']} vs {record['x_label']}").setPos(left + 10, 2)
        self.scene.setSceneRect(0, 0, 810, 470)

    def _probe(self):
        try:
            value = float(self.x.text())
            if not math.isfinite(value):
                raise ValueError
            record = self._series[self.selector.currentIndex()]
            x, y = min(record["points"], key=lambda point: abs(point[0] - value))
            self.readout.setText(f"{record['x_label']}={x:.6g}; {record['y_label']}={y:.6g}")
        except (ValueError, OverflowError):
            self.readout.setText("Enter a finite X coordinate.")


def _string(obj, name, value):
    if name not in obj.PropertiesList:
        obj.addProperty("App::PropertyString", name, "SPIKE Link")
    setattr(obj, name, str(value))


def _linked_group(document):
    for obj in document.Objects:
        if obj.TypeId == "App::DocumentObjectGroup" and "SPIKEKiCadSource" in obj.PropertiesList:
            return obj
    group = document.addObject("App::DocumentObjectGroup", "SPIKEKiCadLink")
    group.Label = "SPIKE linked KiCad board"
    return group


def _render_link(document, design, path):
    records = component_records(design)
    group = _linked_group(document)
    old = [obj for obj in group.Group if "SPIKEGeometryStatus" in obj.PropertiesList
           and (obj.SPIKEGeometryStatus == "reference_only"
                or str(obj.SPIKEGeometryStatus).startswith("detailed_step"))]
    digest = source_digest(path)
    if (design.get("metadata") or {}).get("source_sha256") != digest:
        raise ValueError("KiCad source changed during import. Refresh the link again.")
    document.openTransaction("Refresh SPIKE KiCad link")
    try:
        for obj in old:
            document.removeObject(obj.Name)
        bounds = board_bounds(design)
        if bounds:
            x0, y0, x1, y1 = bounds
            outline = document.addObject("Part::Feature", "SPIKEBoardBounds")
            outline.Label = "Board bounds (reference only)"
            outline.Shape = Part.makePolygon([
                App.Vector(*freecad_xy(x0, y0), 0), App.Vector(*freecad_xy(x1, y0), 0),
                App.Vector(*freecad_xy(x1, y1), 0), App.Vector(*freecad_xy(x0, y1), 0),
                App.Vector(*freecad_xy(x0, y0), 0),
            ])
            if outline.ViewObject is not None:
                outline.ViewObject.LineColor = (0.16, 0.75, 0.93)
                outline.ViewObject.LineWidth = 2.0
            _string(outline, "SPIKEGeometryStatus", "reference_only")
            group.addObject(outline)
        for record in records:
            obj = document.addObject("Part::Feature", "SPIKEPart")
            obj.Label = record["reference"]
            # A point marker carries KiCad position; it is not a package shape.
            obj.Shape = Part.Vertex(App.Vector(*freecad_xy(record["x_mm"], record["y_mm"]), 0))
            if obj.ViewObject is not None:
                obj.ViewObject.PointColor = (1.0, 0.68, 0.2)
                obj.ViewObject.PointSize = 4.0
            for key, field in (
                ("SPIKEReference", "reference"), ("SPIKESourceId", "source_id"),
                ("SPIKELibrary", "library"), ("SPIKEValue", "value"),
                ("SPIKEModelPath", "model_path"), ("SPIKEModelResolved", "model_resolved"),
                ("SPIKELayer", "layer"),
            ):
                _string(obj, key, record[field])
            _string(obj, "SPIKEPropertiesJSON", json.dumps(record["properties"], sort_keys=True))
            _string(obj, "SPIKENetsJSON", json.dumps(record["nets"]))
            _string(obj, "SPIKEKiCadXmm", record["x_mm"])
            _string(obj, "SPIKEKiCadYmm", record["y_mm"])
            _string(obj, "SPIKEGeometryStatus", "reference_only")
            group.addObject(obj)
        _string(group, "SPIKEKiCadSource", os.path.abspath(path))
        _string(group, "SPIKEKiCadSHA256", digest)
        _string(group, "SPIKEDesignId", design.get("design_id", ""))
        _string(group, "SPIKEPartCount", len(records))
        document.recompute()
        document.commitTransaction()
    except Exception:
        document.abortTransaction()
        raise
    return len(records)


class SolverPanel(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("SPIKE Solver Suite")
        self._process = None
        self._cad_process = None
        self._cad_output = bytearray()
        self._output = bytearray()
        self._request_id = 0
        self._pending = None
        self._design = None
        self._result = None
        self._source_digest = ""
        self._catalog = []
        self._document_name = ""
        self._result_digest = ""
        self._pending_digest = ""
        self._projection = None
        self._suite_queue = []
        self._suite_results = []
        self._plot_dialogs = []
        self._models_before_result = False
        settings = App.ParamGet("User parameter:BaseApp/Preferences/Mod/SPIKEWorkbench")
        self._settings = settings
        root = Path(__file__).resolve()
        default_root = next((str(p) for p in root.parents if (p / "python" / "spike_core" / "service.py").is_file()), "")
        self.setObjectName("SPIKESolverPanel")
        self.setStyleSheet("""
            #SPIKESolverPanel { background: #202a35; color: #e5edf4; }
            #SPIKESolverPanel QLabel { color: #e5edf4; }
            #SPIKESolverPanel QCheckBox { color: #e5edf4; spacing: 6px; }
            #SPIKESolverPanel QHeaderView::section { background: #354b5e;
                color: #e5edf4; border: 1px solid #617b8e; padding: 4px; }
            #SPIKESolverPanel QGroupBox { background: #263442; border: 1px solid #485a6b; border-radius: 7px;
                margin-top: 12px; padding: 12px 8px 8px; font-weight: 600; }
            #SPIKESolverPanel QGroupBox::title { subcontrol-origin: margin; left: 12px;
                padding: 0 5px; color: #8cdded; }
            #SPIKESolverPanel QTabWidget::pane { border: 1px solid #485a6b; }
            #SPIKESolverPanel QTabBar::tab { background: #354554; color: #e5edf4;
                min-width: 100px; padding: 8px 12px; }
            #SPIKESolverPanel QTabBar::tab:selected { background: #376479; }
            #SPIKESolverPanel QPushButton { background: #354b5e; color: #e5edf4;
                border: 1px solid #617b8e; border-radius: 4px; min-height: 25px; padding: 3px 8px; }
            #SPIKESolverPanel QPushButton:hover { background: #42647a; }
            #SPIKESolverPanel QLineEdit, #SPIKESolverPanel QPlainTextEdit,
            #SPIKESolverPanel QComboBox, #SPIKESolverPanel QTableWidget { background: #17212c;
                color: #e5edf4; border: 1px solid #546777; border-radius: 3px; }
            #SPIKESolverPanel QLabel#SPIKEStatus { padding: 8px; background: #153544;
                border-left: 3px solid #42bfd7; border-radius: 3px; }
        """)
        outer = QtWidgets.QVBoxLayout(self)
        outer.setContentsMargins(10, 10, 10, 10)
        heading = QtWidgets.QHBoxLayout()
        brand = QtWidgets.QLabel("SPIKE  ·  FreeCAD workbench")
        brand.setStyleSheet("font-size: 17px; font-weight: 700; color: #8cdded;")
        heading.addWidget(brand)
        heading.addStretch()
        help_button = QtWidgets.QPushButton(QtGui.QIcon(os.path.join(ICON_ROOT, "Help.svg")), "Help  F1")
        help_button.setToolTip("Open the detailed SPIKE workbench guide")
        help_button.clicked.connect(lambda: show_help(self))
        heading.addWidget(help_button)
        outer.addLayout(heading)
        shortcut_class = getattr(QtWidgets, "QShortcut", None) or QtGui.QShortcut
        self.help_shortcut = shortcut_class(QtGui.QKeySequence("F1"), self)
        self.help_shortcut.activated.connect(lambda: show_help(self))
        self.pages = QtWidgets.QTabWidget()
        outer.addWidget(self.pages, 1)
        layout = self._page("1  Board", "DetailedBoard.svg")
        self.resize(920, 780)
        self.repo = QtWidgets.QLineEdit(settings.GetString("SpikeRoot", default_root))
        bundled_python = Path(default_root) / ".venv" / "Scripts" / "python.exe"
        default_python = str(bundled_python) if bundled_python.is_file() else "python"
        self.python = QtWidgets.QLineEdit(settings.GetString("SpikePython", os.environ.get("SPIKE_PYTHON", default_python)))
        self.board = QtWidgets.QLineEdit()
        self.kicad_cli = QtWidgets.QLineEdit(settings.GetString("KiCadCLI", ""))
        self._watcher = QtCore.QFileSystemWatcher(self)
        self._watcher.fileChanged.connect(self._source_changed)
        source_box = QtWidgets.QGroupBox("Source and worker")
        source_layout = QtWidgets.QVBoxLayout(source_box)
        for label, edit, browse in (
            ("SPIKE source", self.repo, "directory"),
            ("Worker Python", self.python, "file"),
            ("KiCad PCB", self.board, "board"),
        ):
            row = QtWidgets.QHBoxLayout()
            row.addWidget(QtWidgets.QLabel(label))
            row.addWidget(edit)
            button = QtWidgets.QPushButton("Browse")
            button.clicked.connect(lambda checked=False, target=edit, kind=browse: self._browse(target, kind))
            row.addWidget(button)
            source_layout.addLayout(row)
        layout.addWidget(source_box)
        row = QtWidgets.QHBoxLayout()
        for label, callback in (("Link / refresh board", self.refresh_board), ("Catalog", self.catalog)):
            button = QtWidgets.QPushButton(label)
            button.clicked.connect(callback)
            row.addWidget(button)
        layout.addLayout(row)
        geometry_box = QtWidgets.QGroupBox("Detailed geometry")
        geometry_layout = QtWidgets.QVBoxLayout(geometry_box)
        cad_row = QtWidgets.QHBoxLayout()
        cad_row.addWidget(QtWidgets.QLabel("KiCad CLI"))
        self.kicad_cli.setPlaceholderText("Auto-detect kicad-cli")
        cad_row.addWidget(self.kicad_cli)
        detail = QtWidgets.QPushButton("Import detailed board + copper")
        detail.clicked.connect(self.import_detailed_board)
        cad_row.addWidget(detail)
        geometry_layout.addLayout(cad_row)
        self.auto_detail = QtWidgets.QCheckBox("Import detailed STEP after board link")
        self.auto_detail.setChecked(True)
        geometry_layout.addWidget(self.auto_detail)
        layout.addWidget(geometry_box)
        visibility_box = QtWidgets.QGroupBox("Show in FreeCAD")
        visibility = QtWidgets.QGridLayout(visibility_box)
        for position, (label, kind) in enumerate((("Board substrate", "board"), ("Copper, pads and vias", "copper"),
                            ("3D models", "components"),
                            ("KiCad references", "reference"), ("Result field", "result"),
                            ("Mesh preview", "mesh"))):
            toggle = QtWidgets.QCheckBox(label)
            toggle.setChecked(True)
            toggle.toggled.connect(lambda shown, role=kind: self.set_layer_visibility(role, shown))
            visibility.addWidget(toggle, position // 2, position % 2)
            setattr(self, f"show_{kind}", toggle)
        layout.addWidget(visibility_box)
        color_key = QtWidgets.QLabel("Color key: substrate green  ·  copper gold  ·  3D models silver  ·  results blue → red")
        color_key.setWordWrap(True)
        layout.addWidget(color_key)
        layout.addWidget(QtWidgets.QLabel("Linked part information · choose a row to select its KiCad reference in FreeCAD"))
        self.part_filter = QtWidgets.QLineEdit()
        self.part_filter.setPlaceholderText("Filter parts by reference, value, library, or net")
        self.part_filter.textChanged.connect(self._filter_parts)
        layout.addWidget(self.part_filter)
        self.parts = QtWidgets.QTableWidget(0, 4)
        self.parts.setHorizontalHeaderLabels(["Reference", "Value", "Library", "Nets"])
        self.parts.setMinimumHeight(240)
        self.parts.setAlternatingRowColors(True)
        self.parts.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.parts.horizontalHeader().setStretchLastSection(True)
        self.parts.itemSelectionChanged.connect(self._select_part)
        layout.addWidget(self.parts)
        layout.addStretch()
        layout = self._page("2  Simulate", "Thermal.svg")
        layout.addWidget(QtWidgets.QLabel("Choose Thermal, PI / DC, or SI. Run a mesh preview before interpreting a spatial result."))
        self._build_simulation_tabs(layout)
        layout.addStretch()
        layout = self._page("3  Results", "ResultField.svg")
        layout.addWidget(QtWidgets.QLabel("Results retain the worker's status and model limits. Fields appear only when samples are supplied."))
        self.auto_hide_models = QtWidgets.QCheckBox("Hide 3D models while a field is shown")
        self.auto_hide_models.setChecked(True)
        layout.addWidget(self.auto_hide_models)
        response_row = QtWidgets.QHBoxLayout()
        save = QtWidgets.QPushButton("Save response JSON")
        save.clicked.connect(self.save_result)
        response_row.addWidget(save)
        load = QtWidgets.QPushButton("Load response JSON")
        load.clicked.connect(self.load_result)
        response_row.addWidget(load)
        layout.addLayout(response_row)
        plot = QtWidgets.QPushButton("Plot supplied SI / circuit traces")
        plot.clicked.connect(self.show_trace_plot)
        layout.addWidget(plot)
        result_row = QtWidgets.QHBoxLayout()
        self.field = QtWidgets.QComboBox()
        self.field.setToolTip("Only fields supplied as spatial samples by the selected SPIKE result appear here.")
        result_row.addWidget(self.field)
        for label, callback in (("Show field", self.show_field), ("Clear field", self.clear_field)):
            button = QtWidgets.QPushButton(label)
            button.clicked.connect(callback)
            result_row.addWidget(button)
        layout.addLayout(result_row)
        legend = QtWidgets.QLabel()
        legend.setFixedHeight(14)
        legend.setStyleSheet("background: qlineargradient(x1:0, y1:0, x2:1, y2:0, "
                             "stop:0 #1737b5, stop:0.33 #1fc5d8, stop:0.67 #f2d551, stop:1 #d83f30);")
        layout.addWidget(legend)
        self.legend_values = QtWidgets.QLabel("No spatial field displayed")
        layout.addWidget(self.legend_values)
        probe_row = QtWidgets.QHBoxLayout()
        self.probe_x = QtWidgets.QLineEdit()
        self.probe_y = QtWidgets.QLineEdit()
        self.probe_x.setPlaceholderText("KiCad X mm")
        self.probe_y.setPlaceholderText("KiCad Y mm")
        probe_row.addWidget(self.probe_x)
        probe_row.addWidget(self.probe_y)
        for label, callback in (("Probe XY", self.probe_xy), ("Probe picked point", self.probe_selection)):
            button = QtWidgets.QPushButton(label)
            button.clicked.connect(callback)
            probe_row.addWidget(button)
        layout.addLayout(probe_row)
        layout.addWidget(QtWidgets.QLabel("Worker response (read only)"))
        self.report = QtWidgets.QPlainTextEdit()
        self.report.setReadOnly(True)
        self.report.setMinimumHeight(330)
        layout.addWidget(self.report)
        layout = self._page("4  Advanced", "SolverSuite.svg")
        layout.addWidget(QtWidgets.QLabel("Advanced requests use SPIKE worker JSON contracts. Consult Help before running a method."))
        self.solver = QtWidgets.QComboBox()
        self.solver.addItem("auto", "auto")
        layout.addWidget(self.solver)
        layout.addWidget(QtWidgets.QLabel("Analysis spec (JSON); source and solver catalog stay linked to the board"))
        self.spec = QtWidgets.QPlainTextEdit('{"mode":"dc","solver_id":"auto","net_names":[],"sources":[],"loads":[]}')
        layout.addWidget(self.spec)
        row = QtWidgets.QHBoxLayout()
        for label, callback in (("Preflight", self.preflight), ("Run analysis", self.run_analysis), ("Cancel", self.cancel)):
            button = QtWidgets.QPushButton(label)
            button.clicked.connect(callback)
            row.addWidget(button)
        layout.addLayout(row)
        layout.addWidget(QtWidgets.QLabel("Advanced worker method and params (JSON)"))
        row = QtWidgets.QHBoxLayout()
        self.method = QtWidgets.QComboBox()
        self.method.setEditable(True)
        self.method.addItems(_WORKER_METHODS)
        self.params = QtWidgets.QPlainTextEdit("{}")
        row.addWidget(self.method)
        self.attach_design = QtWidgets.QCheckBox("Attach linked board")
        self.attach_design.setChecked(True)
        row.addWidget(self.attach_design)
        advanced = QtWidgets.QPushButton("Run method")
        advanced.clicked.connect(self.run_method)
        row.addWidget(advanced)
        layout.addLayout(row)
        layout.addWidget(self.params)
        layout.addWidget(QtWidgets.QLabel("Configured suite jobs (JSON array of method + params)"))
        self.suite = QtWidgets.QPlainTextEdit("[]")
        self.suite.setMaximumHeight(65)
        layout.addWidget(self.suite)
        suite_button = QtWidgets.QPushButton("Run configured suite")
        suite_button.clicked.connect(self.run_suite)
        layout.addWidget(suite_button)
        layout.addStretch()
        footer = QtWidgets.QHBoxLayout()
        self.status = QtWidgets.QLabel("Choose a KiCad board and link it.")
        self.status.setObjectName("SPIKEStatus")
        self.status.setWordWrap(True)
        footer.addWidget(self.status, 1)
        self.busy = QtWidgets.QProgressBar()
        self.busy.setRange(0, 0)
        self.busy.setFixedWidth(100)
        self.busy.hide()
        footer.addWidget(self.busy)
        cancel_button = QtWidgets.QPushButton("Cancel")
        cancel_button.clicked.connect(self.cancel)
        footer.addWidget(cancel_button)
        outer.addLayout(footer)
        document = App.ActiveDocument
        if document:
            for obj in document.Objects:
                if "SPIKEKiCadSource" in obj.PropertiesList:
                    self.board.setText(obj.SPIKEKiCadSource)
                    break

    def _page(self, title, icon):
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAlwaysOff)
        content = QtWidgets.QWidget()
        content.setObjectName("SPIKEPage")
        content.setStyleSheet("#SPIKEPage { background: #202a35; }")
        layout = QtWidgets.QVBoxLayout(content)
        layout.setSpacing(10)
        scroll.setWidget(content)
        self.pages.addTab(scroll, QtGui.QIcon(os.path.join(ICON_ROOT, icon)), title)
        return layout

    def _filter_parts(self, query):
        needle = query.strip().casefold()
        for row in range(self.parts.rowCount()):
            values = [self.parts.item(row, column) for column in range(self.parts.columnCount())]
            self.parts.setRowHidden(row, bool(needle) and not any(
                item and needle in item.text().casefold() for item in values))

    def _select_part(self):
        rows = self.parts.selectionModel().selectedRows()
        document = App.ActiveDocument
        if not rows or document is None or document.Name != self._document_name:
            return
        reference = self.parts.item(rows[0].row(), 0)
        if reference is None:
            return
        for obj in document.Objects:
            if getattr(obj, "SPIKEReference", "") == reference.text():
                Gui.Selection.clearSelection()
                Gui.Selection.addSelection(document.Name, obj.Name)
                self.status.setText(f"Selected {reference.text()} · inspect its KiCad properties in FreeCAD.")
                return

    def _form_edit(self, form, label, value):
        edit = QtWidgets.QLineEdit(str(value))
        form.addRow(label, edit)
        return edit

    def _build_simulation_tabs(self, layout):
        tabs = QtWidgets.QTabWidget()
        layout.addWidget(tabs)
        thermal = QtWidgets.QWidget()
        thermal_form = QtWidgets.QFormLayout(thermal)
        thermal_form.setRowWrapPolicy(QtWidgets.QFormLayout.WrapLongRows)
        self.thermal_inputs = {}
        for key, label, default in (
            ("ambient_temperature_c", "Ambient °C", "25"),
            ("conductivity_w_mk", "Effective board conductivity W/mK", "20"),
            ("thickness_mm", "Board thickness mm", "1.6"),
            ("convection_top_w_m2k", "Top convection W/m²K", "10"),
            ("convection_bottom_w_m2k", "Bottom convection W/m²K", "10"),
            ("grid_step_mm", "Grid step mm", "2"),
            ("contact_size_mm", "Square contact mm", "8"),
            ("r_junction_case_k_w", "Junction to case K/W", "2"),
            ("r_case_board_k_w", "Case to board K/W", "3"),
        ):
            self.thermal_inputs[key] = self._form_edit(thermal_form, label, default)
        self.thermal_parts = QtWidgets.QTableWidget(0, 2)
        self.thermal_parts.setHorizontalHeaderLabels(["Component", "Power W (blank excludes)"])
        self.thermal_parts.setMaximumHeight(180)
        thermal_form.addRow("Assigned losses", self.thermal_parts)
        self.thermal_pad_contacts = QtWidgets.QCheckBox("Couple powered parts through imported copper pad lands")
        thermal_form.addRow(self.thermal_pad_contacts)
        thermal_button = QtWidgets.QPushButton("Run board thermal")
        thermal_button.clicked.connect(self.run_thermal_form)
        thermal_form.addRow(thermal_button)
        thermal_preview = QtWidgets.QPushButton("Preview thermal grid in FreeCAD")
        thermal_preview.clicked.connect(self.preview_thermal_grid)
        thermal_form.addRow(thermal_preview)
        thermal_button.setToolTip("Runs the approximate board heat model using explicit losses and materials.")
        thermal_preview.setToolTip("Draws the solver's rectangular thermal grid; no heat solve runs.")
        tabs.addTab(thermal, QtGui.QIcon(os.path.join(ICON_ROOT, "Thermal.svg")), "Thermal")

        pi = QtWidgets.QWidget()
        pi_form = QtWidgets.QFormLayout(pi)
        pi_form.setRowWrapPolicy(QtWidgets.QFormLayout.WrapLongRows)
        self.pi_net = QtWidgets.QComboBox()
        self.pi_net.currentIndexChanged.connect(self._update_pi_pads)
        self.pi_source = QtWidgets.QComboBox()
        self.pi_load = QtWidgets.QComboBox()
        pi_form.addRow("Copper net", self.pi_net)
        pi_form.addRow("Source pad", self.pi_source)
        pi_form.addRow("Load pad", self.pi_load)
        self.pi_voltage = self._form_edit(pi_form, "Source voltage V", "12")
        self.pi_current = self._form_edit(pi_form, "Load current A", "1")
        self.pi_cell = self._form_edit(pi_form, "Zone cell mm", "0.5")
        self.pi_preview_limit = self._form_edit(pi_form, "Maximum preview cells", "5000")
        pi_button = QtWidgets.QPushButton("Preflight PI/DC")
        pi_button.clicked.connect(lambda: self.run_pi_form(preflight=True))
        pi_form.addRow(pi_button)
        pi_run = QtWidgets.QPushButton("Run PI/DC copper analysis")
        pi_run.clicked.connect(self.run_pi_form)
        pi_form.addRow(pi_run)
        pi_preview = QtWidgets.QPushButton("Preview actual PI mesh in FreeCAD")
        pi_preview.clicked.connect(self.preview_pi_mesh)
        pi_form.addRow(pi_preview)
        pi_convergence = QtWidgets.QPushButton("Run 3-level PI mesh convergence")
        pi_convergence.clicked.connect(self.run_pi_convergence)
        pi_form.addRow(pi_convergence)
        pi_preview.setToolTip("Requests SPIKE's actual selected-net copper mesh and draws its cell outlines.")
        pi_convergence.setToolTip("Runs three cell sizes and reports SPIKE's numerical convergence status.")
        tabs.addTab(pi, QtGui.QIcon(os.path.join(ICON_ROOT, "PowerIntegrity.svg")), "PI / DC")

        si = QtWidgets.QWidget()
        si_form = QtWidgets.QFormLayout(si)
        si_form.setRowWrapPolicy(QtWidgets.QFormLayout.WrapLongRows)
        si_form.addRow(QtWidgets.QLabel("Explicit uniform RLGC model; values are user-supplied, not extracted from PCB copper."))
        self.si_inputs = {}
        for key, label, default in (
            ("length_m", "Length m", "0.05"),
            ("resistance_ohm_per_m", "R Ω/m", "5"),
            ("inductance_h_per_m", "L H/m", "2.5e-7"),
            ("capacitance_f_per_m", "C F/m", "1e-10"),
            ("loss_tangent", "Loss tangent", "0.015"),
            ("frequency_stop_hz", "Stop frequency Hz", "8e9"),
            ("reference_impedance_ohm", "Reference impedance Ω", "50"),
            ("high_v", "Source high V", "1.8"),
            ("rise_time_s", "Rise/fall time s", "1e-10"),
            ("vil_v", "Receiver VIL V", "0.63"),
            ("vih_v", "Receiver VIH V", "1.17"),
            ("bit_rate_hz", "Bit rate Hz", "1e9"),
            ("temperature_c", "Temperature °C", "25"),
        ):
            self.si_inputs[key] = self._form_edit(si_form, label, default)
        si_button = QtWidgets.QPushButton("Run SI channel workflow")
        si_button.clicked.connect(self.run_si_form)
        si_form.addRow(si_button)
        si_form.addRow(QtWidgets.QLabel("Bounded board extraction requires one uniform trace over a declared reference zone."))
        self.si_signal_net = QtWidgets.QComboBox()
        self.si_reference_net = QtWidgets.QComboBox()
        self.si_reference_layer = QtWidgets.QComboBox()
        self.si_path_mode = QtWidgets.QComboBox()
        self.si_path_mode.addItems(["strict_uniform", "piecewise_planar"])
        si_form.addRow("Signal net", self.si_signal_net)
        si_form.addRow("Reference net", self.si_reference_net)
        si_form.addRow("Reference copper layer", self.si_reference_layer)
        si_form.addRow("Path mode", self.si_path_mode)
        geometry_button = QtWidgets.QPushButton("Run linked board SI extraction")
        geometry_button.clicked.connect(self.run_geometry_si_form)
        si_form.addRow(geometry_button)
        geometry_button.setToolTip("Requests the strict DesignIR v2 geometry channel; unsupported layouts are rejected.")
        tabs.addTab(si, QtGui.QIcon(os.path.join(ICON_ROOT, "SignalIntegrity.svg")), "SI")

    def _update_pi_pads(self, *_):
        self.pi_source.clear()
        self.pi_load.clear()
        if self._design is None:
            return
        labels = [pad_label(pad) for pad in pads_for_net(self._design, self.pi_net.currentText())]
        self.pi_source.addItems(labels)
        self.pi_load.addItems(labels)
        if len(labels) > 1:
            self.pi_load.setCurrentIndex(1)

    def _update_simulation_sources(self):
        records = component_records(self._design)
        self.thermal_parts.setRowCount(len(records))
        for row, record in enumerate(records):
            ref = QtWidgets.QTableWidgetItem(record["reference"])
            ref.setFlags(ref.flags() & ~QtCore.Qt.ItemIsEditable)
            self.thermal_parts.setItem(row, 0, ref)
            self.thermal_parts.setItem(row, 1, QtWidgets.QTableWidgetItem(""))
        nets = sorted({str(pad.get("net_name")) for pad in self._design.get("pads", []) if pad.get("net_name")})
        self.pi_net.clear()
        self.pi_net.addItems(nets)
        self._update_pi_pads()
        self.si_signal_net.clear()
        self.si_reference_net.clear()
        self.si_reference_layer.clear()
        self.si_signal_net.addItems(nets)
        self.si_reference_net.addItems(nets)
        self.si_reference_layer.addItems(sorted({str(layer.get("name")) for layer in self._design.get("layers", [])
                                                if str(layer.get("name", "")).endswith(".Cu")}))
        if "GND" in nets:
            self.si_reference_net.setCurrentText("GND")

    def run_thermal_form(self):
        try:
            design = self._current_design()
            values = {key: edit.text() for key, edit in self.thermal_inputs.items()}
            components = []
            for row in range(self.thermal_parts.rowCount()):
                power = self.thermal_parts.item(row, 1)
                if power and power.text().strip():
                    components.append({"component_ref": self.thermal_parts.item(row, 0).text(),
                                       "power_w": power.text(),
                                       "contact_mode": "pads" if self.thermal_pad_contacts.isChecked() else "square",
                                       "contact_size_mm": values["contact_size_mm"],
                                       "r_junction_case_k_w": values["r_junction_case_k_w"],
                                       "r_case_board_k_w": values["r_case_board_k_w"]})
            request = thermal_request(design, values, components)
            thermal_grid(board_bounds(design), request["board"]["grid_step_mm"])
            self._call("run_board_thermal", {"design": design, "request": request}, self._thermal_done)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def _thermal_done(self, result):
        if isinstance(result, dict) and result.get("grid") and available_fields(self._result):
            self.show_field()

    def preview_thermal_grid(self):
        try:
            design = self._current_design()
            grid = thermal_grid(board_bounds(design), self.thermal_inputs["grid_step_mm"].text())
            render_thermal_grid(App.ActiveDocument, grid)
            nx, ny = grid["shape"]
            dx, dy = grid["spacing_mm"]
            self.status.setText(f"Thermal grid preview: {nx} × {ny} = {nx * ny} cells; "
                                f"actual spacing {dx:.4g} × {dy:.4g} mm. No solve run.")
        except (ValueError, RuntimeError, OSError) as exc:
            self._fail(exc)

    def run_pi_form(self, preflight=False):
        try:
            design = self._current_design()
            spec = dc_spec(design, self.pi_net.currentText(), self.pi_source.currentText(),
                           self.pi_load.currentText(), self.pi_voltage.text(),
                           self.pi_current.text(), self.pi_cell.text())
            self.spec.setPlainText(json.dumps(spec, indent=2))
            method = "preflight_analysis" if preflight else "run_preflighted_analysis"
            self._call(method, {"design": design, "spec": spec}, None)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def preview_pi_mesh(self):
        try:
            design = self._current_design()
            spec = dc_spec(design, self.pi_net.currentText(), self.pi_source.currentText(),
                           self.pi_load.currentText(), self.pi_voltage.text(),
                           self.pi_current.text(), self.pi_cell.text())
            limit = int(self.pi_preview_limit.text())
            if not 1 <= limit <= 5000:
                raise ValueError("Preview limit must be 1–5000 cells.")
            spec["mesh"]["max_preview_cells"] = limit
            self._call("preview_mesh", {"design": design, "spec": spec}, self._pi_mesh_done)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def _pi_mesh_done(self, result):
        render_pi_mesh(App.ActiveDocument, result)
        self.show_mesh.setChecked(True)
        quality = result.get("quality") or {}
        self.status.setText(f"PI mesh preview: {result.get('cell_count', 0)} cells; "
                            f"truncated={bool(result.get('truncated'))}; "
                            f"maximum aspect ratio={quality.get('maximum_aspect_ratio', 'unknown')}. "
                            "Preview is sampled geometry, not a solved field.")

    def run_pi_convergence(self):
        try:
            design = self._current_design()
            spec = dc_spec(design, self.pi_net.currentText(), self.pi_source.currentText(),
                           self.pi_load.currentText(), self.pi_voltage.text(),
                           self.pi_current.text(), self.pi_cell.text())
            self._call("mesh_convergence", {"design": design, "spec": spec,
                                            "options": {"levels": [2.0, 1.0, 0.5],
                                                        "minimum_levels": 3}}, None)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def run_si_form(self):
        try:
            values = {key: edit.text() for key, edit in self.si_inputs.items()}
            request = si_request(values)
            self._call("run_si_workflow", {"request": request}, None)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def run_geometry_si_form(self):
        try:
            design = self._current_design()
            request = geometry_si_request(design, self.si_signal_net.currentText(),
                                          self.si_reference_net.currentText(),
                                          self.si_reference_layer.currentText(),
                                          self.si_inputs["frequency_stop_hz"].text(),
                                          self.si_path_mode.currentText())
            self._geometry_si_request = request
            self._geometry_si_digest = self._source_digest
            self._call("import_design_v2", {"path": os.path.abspath(self.board.text())},
                       self._geometry_si_loaded)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def _geometry_si_loaded(self, result):
        if self._source_digest != self._geometry_si_digest:
            raise ValueError("KiCad board changed during SI import. Refresh and retry.")
        design = result.get("design") if isinstance(result, dict) else None
        if not isinstance(design, dict) or design.get("contract") != "spike/design-ir/v2":
            raise ValueError("Worker did not return canonical DesignIR v2 for board SI.")
        self._call("run_si_uniform_channel", {"design": design,
                                               "request": self._geometry_si_request}, None)

    def _browse(self, target, kind):
        if kind == "directory":
            value = QtWidgets.QFileDialog.getExistingDirectory(self, "SPIKE source directory", target.text())
        else:
            title = "KiCad board" if kind == "board" else "Python executable"
            filter_value = "KiCad PCB (*.kicad_pcb)" if kind == "board" else "All files (*)"
            value = QtWidgets.QFileDialog.getOpenFileName(self, title, target.text(), filter_value)
            if isinstance(value, (tuple, list)):
                value = value[0]
        if value:
            target.setText(str(value))

    def _fail(self, message):
        self.status.setText("Failed: " + str(message))
        self.report.setPlainText(str(message))

    def _call(self, method, params, done):
        if self._process is not None:
            self._fail("A SPIKE worker request is already running.")
            return
        try:
            root, executable = validate_runtime(self.repo.text(), self.python.text())
            self._settings.SetString("SpikeRoot", root)
            self._settings.SetString("SpikePython", executable)
            self._request_id += 1
            payload = request_line(method, params, self._request_id)
            candidate = params.get("design")
            self._pending_digest = (self._source_digest if isinstance(candidate, dict)
                                    and self._design is not None
                                    and candidate.get("design_id") == self._design.get("design_id") else "")
        except (ValueError, TypeError, OSError) as exc:
            self._fail(exc)
            return
        process = QtCore.QProcess(self)
        process.setProgram(executable)
        process.setArguments(["-m", "python.spike_core.service"])
        process.setWorkingDirectory(root)
        environment = QtCore.QProcessEnvironment.systemEnvironment()
        environment.insert("PYTHONPATH", root + os.pathsep + environment.value("PYTHONPATH"))
        process.setProcessEnvironment(environment)
        self._output = bytearray()
        self._process = process
        self._pending = done
        self._active_method = method
        self.busy.show()
        process.readyReadStandardOutput.connect(self._read_output)
        process.finished.connect(self._finished)
        process.errorOccurred.connect(self._process_error)
        self.status.setText("Running " + method + " ...")
        process.start()
        if not process.waitForStarted(3000):
            self._fail(process.errorString())
            self._process = None
            self.busy.hide()
            process.deleteLater()
            return
        process.write(payload)
        process.closeWriteChannel()

    def _read_output(self):
        if self._process is None:
            return
        self._output.extend(bytes(self._process.readAllStandardOutput()))
        if len(self._output) > _MAX_RESPONSE:
            self._process.kill()
            self._fail("Worker response exceeded 64 MiB. Use a bounded request or SPIKE CLI artifact output.")

    def _process_error(self, _error):
        if self._process is not None:
            self._fail(self._process.errorString())

    def _finished(self, exit_code, _exit_status):
        process = self._process
        if process is None:
            return
        self._read_output()
        self._process = None
        self.busy.hide()
        stderr = bytes(process.readAllStandardError()).decode("utf-8", errors="replace")[-4000:]
        process.deleteLater()
        if exit_code != 0:
            self._fail(stderr or f"Worker exited with code {exit_code}.")
            return
        try:
            lines = self._output.splitlines()
            if len(lines) != 1:
                raise ValueError("Expected one JSON response from the SPIKE worker.")
            response = json.loads(lines[0])
            if response.get("id") != self._request_id or not response.get("ok"):
                raise ValueError(response.get("error") or "Worker response ID did not match.")
            self._result = response
            self._result_digest = self._pending_digest
            self._projection = None
            result = response.get("result")
            self.report.setPlainText(json.dumps(result, indent=2, default=str)[:100000])
            self.field.clear()
            self.field.addItems(available_fields(response))
            status = result.get("status", "completed") if isinstance(result, dict) else "completed"
            actual = result.get("analysis_result") if isinstance(result, dict) else None
            model = (actual or result).get("model_status", "") if isinstance(result, dict) else ""
            self.status.setText(f"{status} {model}".strip())
            if self._pending:
                self._pending(result)
            if self._active_method in {"run_board_thermal", "run_preflighted_analysis",
                                       "run_si_workflow", "run_si_uniform_channel",
                                       "mesh_convergence"}:
                self.pages.setCurrentIndex(2)
        except Exception as exc:  # GUI boundary: keep FreeCAD responsive after an import error.
            self._fail(exc)

    def cancel(self):
        if self._process is not None:
            self._process.kill()
            self.busy.hide()
            self.status.setText("Cancelled")
        if self._cad_process is not None:
            self._cad_process.kill()
            self.busy.hide()
            self.status.setText("Detailed board export cancelled")

    def refresh_board(self):
        path = self.board.text().strip()
        if not path.lower().endswith(".kicad_pcb") or not Path(path).is_file():
            self._fail("Select an existing .kicad_pcb file.")
            return
        self._call("load_design", {"path": os.path.abspath(path)}, self._loaded)

    def _loaded(self, design):
        if not isinstance(design, dict):
            raise ValueError("Worker did not return a DesignIR object.")
        document = App.ActiveDocument or App.newDocument("SPIKE_KiCad_Link")
        clear_overlay(document)
        clear_mesh_preview(document)
        self.legend_values.setText("No spatial field displayed")
        if self._models_before_result:
            self.show_components.setChecked(True)
            self._models_before_result = False
        count = _render_link(document, design, self.board.text())
        self._design = design
        self._document_name = document.Name
        self._source_digest = source_digest(self.board.text())
        watched = self._watcher.files()
        if watched:
            self._watcher.removePaths(watched)
        self._watcher.addPath(os.path.abspath(self.board.text()))
        records = component_records(design)
        self.parts.setRowCount(len(records))
        for row, item in enumerate(records):
            for column, value in enumerate((item["reference"], item["value"], item["library"], ", ".join(item["nets"]))):
                self.parts.setItem(row, column, QtWidgets.QTableWidgetItem(str(value)))
        self._filter_parts(self.part_filter.text())
        self._update_simulation_sources()
        self.status.setText(f"Linked {count} KiCad parts; geometry is reference only.")
        Gui.activeDocument().activeView().fitAll()
        if self.auto_detail.isChecked():
            self.import_detailed_board()

    def _source_changed(self, _path):
        if App.ActiveDocument is not None:
            clear_overlay(App.ActiveDocument)
            clear_mesh_preview(App.ActiveDocument)
        self._projection = None
        self.legend_values.setText("No spatial field displayed")
        if self._models_before_result:
            self.show_components.setChecked(True)
            self._models_before_result = False
        self.status.setText("KiCad board changed on disk. Refresh the link before analysis.")

    def import_detailed_board(self):
        try:
            self._current_design()
            if self._cad_process is not None:
                raise ValueError("A detailed board export is already running.")
            cli = discover_kicad_cli(self.kicad_cli.text())
            if not cli:
                raise ValueError("KiCad CLI was not found. Set its kicad-cli executable path.")
            self._settings.SetString("KiCadCLI", cli)
            self._cad_cli = cli
            self._cad_digest = self._source_digest
            self._cad_queue = ["board", "components"]
            self._start_next_cad()
        except (ValueError, OSError, RuntimeError) as exc:
            self._fail(exc)

    def _start_next_cad(self):
        if not self._cad_queue:
            Gui.activeDocument().activeView().fitAll()
            return
        kind = self._cad_queue.pop(0)
        cache = Path(tempfile.gettempdir()) / "SPIKEWorkbench" / "step"
        cache.mkdir(parents=True, exist_ok=True)
        target = cache / (self._cad_digest + "-" + kind + ".step")
        self._cad_kind = kind
        self._cad_artifact = str(target)
        if target.is_file():
            try:
                validate_step_artifact(str(target))
                self._apply_detailed_board("", kind)
                self._start_next_cad()
                return
            except ValueError:
                target.unlink(missing_ok=True)
        try:
            args = build_step_export_arguments(self.board.text(), str(target), kind=kind)
            process = QtCore.QProcess(self)
            process.setProgram(self._cad_cli)
            process.setArguments(args)
            process.setProcessChannelMode(QtCore.QProcess.MergedChannels)
            self._cad_output = bytearray()
            self._cad_process = process
            self.busy.show()
            process.readyReadStandardOutput.connect(self._read_cad_output)
            process.finished.connect(self._cad_finished)
            process.start()
            if not process.waitForStarted(3000):
                self._cad_process = None
                self.busy.hide()
                raise ValueError(process.errorString())
            self.status.setText(f"KiCad is exporting {kind} STEP geometry ...")
        except (ValueError, OSError, RuntimeError) as exc:
            self._fail(exc)

    def _read_cad_output(self):
        if self._cad_process is not None:
            self._cad_output.extend(bytes(self._cad_process.readAllStandardOutput()))
            if len(self._cad_output) > 2 * 1024 * 1024:
                self._cad_process.kill()
                self._fail("KiCad export log exceeded 2 MiB.")

    def _cad_finished(self, exit_code, _exit_status):
        process = self._cad_process
        if process is None:
            return
        self._read_cad_output()
        self._cad_process = None
        self.busy.hide()
        process.deleteLater()
        report = self._cad_output.decode("utf-8", errors="replace")
        if exit_code != 0:
            self._fail(f"{self._cad_kind} STEP export failed: " +
                       (report[-4000:] or f"KiCad exited with code {exit_code}."))
            return
        try:
            self._apply_detailed_board(report, self._cad_kind)
            self._start_next_cad()
        except (ValueError, OSError, RuntimeError) as exc:
            self._fail(exc)

    def _apply_detailed_board(self, warnings, kind):
        if self._source_digest != self._cad_digest:
            raise ValueError("KiCad board changed during detailed export. Refresh and retry.")
        document = App.ActiveDocument
        if document is None or document.Name != self._document_name:
            raise ValueError("Activate the linked FreeCAD document before STEP import.")
        unresolved = [record["reference"] for record in component_records(self._design)
                      if record["model_path"] and not record["model_resolved"]]
        context = warnings[-8000:]
        if kind == "components" and unresolved:
            context += "\nUnresolved KiCad model paths in linked DesignIR: " + ", ".join(unresolved)
        feature = apply_step_to_document(document, self.board.text(), self._cad_artifact,
                                         kind=kind,
                                         expected_source_digest=self._cad_digest,
                                         export_warnings=context[-12000:])
        self.status.setText(f"Imported {kind} STEP; {len(unresolved)} unresolved model path(s) in KiCad data. "
                            "Geometry is approximate; inspect export warnings in the linked object.")

    def _current_design(self):
        if self._design is None:
            raise ValueError("Link or refresh a KiCad board first.")
        if App.ActiveDocument is None or App.ActiveDocument.Name != self._document_name:
            raise ValueError("Activate the linked FreeCAD document or refresh its KiCad source.")
        if source_digest(self.board.text()) != self._source_digest:
            raise ValueError("KiCad board changed on disk. Refresh the link before analysis.")
        return self._design

    def catalog(self):
        self._call("list_solvers", {}, self._catalog_loaded)

    def _catalog_loaded(self, result):
        self._catalog = result.get("solvers", []) if isinstance(result, dict) else []
        self.solver.clear()
        self.solver.addItem("auto", "auto")
        for item in self._catalog:
            if item.get("state") in {"available", "experimental"}:
                self.solver.addItem(f"{item.get('name', item.get('id'))} [{item.get('state')}]", item.get("id"))

    def _spec(self):
        design = self._current_design()
        spec = json.loads(self.spec.toPlainText())
        if not isinstance(spec, dict):
            raise ValueError("Analysis spec must be a JSON object.")
        selected_solver = self.solver.currentData() or "auto"
        if selected_solver != "auto":
            spec["solver_id"] = selected_solver
        else:
            spec.setdefault("solver_id", "auto")
        return {"design": design, "spec": spec}

    def preflight(self):
        try:
            self._call("preflight_analysis", self._spec(), None)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def run_analysis(self):
        try:
            self._call("run_preflighted_analysis", self._spec(), None)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def run_method(self):
        try:
            params = json.loads(self.params.toPlainText())
            if not isinstance(params, dict):
                raise ValueError("Method params must be a JSON object.")
            if self.attach_design.isChecked() and "design" not in params and self._design is not None:
                params["design"] = self._current_design()
            self._call(self.method.currentText().strip(), params, None)
        except (ValueError, OSError) as exc:
            self._fail(exc)

    def save_result(self):
        if self._result is None:
            self._fail("There is no worker response to save.")
            return
        path = QtWidgets.QFileDialog.getSaveFileName(self, "Save SPIKE response", "spike-result.json", "JSON (*.json)")
        if isinstance(path, (tuple, list)):
            path = path[0]
        if path:
            Path(path).write_text(json.dumps(self._result, indent=2, allow_nan=False), encoding="utf-8")

    def load_result(self):
        path = QtWidgets.QFileDialog.getOpenFileName(self, "Load SPIKE response", "", "JSON (*.json)")
        if isinstance(path, (tuple, list)):
            path = path[0]
        if not path:
            return
        try:
            source = Path(path)
            if source.stat().st_size > _MAX_RESPONSE:
                raise ValueError("Saved response exceeds the 64 MiB limit.")
            def reject_constant(value):
                raise ValueError(f"Non-finite JSON value: {value}")
            response = json.loads(source.read_text(encoding="utf-8"), parse_constant=reject_constant)
            result = unwrap_result(response)
            provenance = result.get("provenance") or {}
            result_source = str(provenance.get("board_source_sha256") or "")
            result_design = str(provenance.get("design_id") or "")
            current_design = self._design or {}
            if result_source and result_source != self._source_digest:
                raise ValueError("Saved result belongs to another KiCad board revision.")
            if result_design and result_design != current_design.get("design_id"):
                raise ValueError("Saved result belongs to another KiCad design.")
            self._result = response
            self._result_digest = (self._source_digest if result_source or result_design else "")
            self.field.clear()
            self.field.addItems(available_fields(response))
            self.report.setPlainText(json.dumps(result, indent=2, default=str)[:100000])
            binding = "linked board" if self._result_digest else "unbound; spatial overlay disabled"
            self.status.setText(f"Loaded {result.get('status', 'unknown')} "
                                f"{result.get('model_status', '')} result · {binding}")
        except (ValueError, OSError, TypeError, UnicodeError) as exc:
            self._fail(exc)

    def show_trace_plot(self):
        series = extract_series(self._result) if self._result is not None else []
        if not series:
            self._fail("This result supplied no supported 1D traces. Inspect its JSON report.")
            return
        dialog = _TraceDialog(series, self)
        self._plot_dialogs = [item for item in self._plot_dialogs if item.isVisible()]
        self._plot_dialogs.append(dialog)
        dialog.show()

    def show_field(self):
        try:
            design = self._current_design()
            if self._result is None or self._result_digest != self._source_digest:
                raise ValueError("Run an analysis with the current linked board before showing a field.")
            name = self.field.currentText()
            if not name:
                raise ValueError("This result did not provide a spatial scalar field. Inspect its JSON report.")
            projection = project_samples(self._result, name,
                                         design_id=design.get("design_id", ""),
                                         source_sha256=self._source_digest)
            render_overlay(App.ActiveDocument, projection)
            self.show_result.setChecked(True)
            self.show_board.setChecked(True)
            self.show_copper.setChecked(True)
            if self.auto_hide_models.isChecked() and self.show_components.isChecked():
                self._models_before_result = True
                self.show_components.setChecked(False)
            self._projection = projection
            self.legend_values.setText(f"{projection['minimum']:.5g} → {projection['maximum']:.5g} "
                                       f"{projection['unit']}  ·  {projection['field']}  ·  "
                                       f"{projection['model_status']}")
            self.status.setText(f"{name}: {projection['minimum']:.5g}–{projection['maximum']:.5g} "
                                f"{projection['unit']} · {projection['model_status']} · "
                                f"{len(projection['samples'])} supplied samples")
            Gui.activeDocument().activeView().fitAll()
        except (ValueError, RuntimeError, OSError, TypeError) as exc:
            self._fail(exc)

    def clear_field(self):
        if App.ActiveDocument is not None:
            clear_overlay(App.ActiveDocument)
        self._projection = None
        self.legend_values.setText("No spatial field displayed")
        if self._models_before_result:
            self.show_components.setChecked(True)
            self._models_before_result = False
        self.status.setText("SPIKE result overlay cleared.")

    def set_layer_visibility(self, kind, visible):
        document = App.ActiveDocument
        if document is None:
            return
        for obj in document.Objects:
            if obj.TypeId != "Part::Feature":
                continue
            status = str(getattr(obj, "SPIKEGeometryStatus", ""))
            matches = ((kind == "board" and status == "detailed_step_board_approximate")
                       or (kind == "copper" and status == "detailed_step_copper_approximate")
                       or (kind == "components" and status == "detailed_step_components_approximate")
                       or (kind == "reference" and status == "reference_only")
                       or (kind == "result" and "SPIKEResultOverlay" in obj.PropertiesList)
                       or (kind == "mesh" and "SPIKEMeshPreview" in obj.PropertiesList))
            if matches and obj.ViewObject is not None:
                obj.ViewObject.Visibility = bool(visible)

    def probe_xy(self):
        try:
            self._current_design()
            if self._projection is None:
                raise ValueError("Show a spatial field before probing.")
            record = probe_nearest(self._projection, self.probe_x.text(), self.probe_y.text())
            self.status.setText(f"{record['field']} = {record['value']:.6g} {record['unit']} at "
                                f"({record['x_mm']:.3f}, {record['y_mm']:.3f}) mm; "
                                f"nearest sample {record['distance_mm']:.3f} mm away · "
                                f"{record['model_status']}")
        except (ValueError, RuntimeError, OSError) as exc:
            self._fail(exc)

    def probe_selection(self):
        try:
            selections = Gui.Selection.getSelectionEx()
            points = [point for item in selections for point in getattr(item, "PickedPoints", [])]
            if not points:
                raise ValueError("Pick a board or result point in FreeCAD, then click Probe picked point.")
            self.probe_x.setText(str(points[0].x))
            self.probe_y.setText(str(-points[0].y))
            self.probe_xy()
        except (ValueError, RuntimeError, OSError) as exc:
            self._fail(exc)

    def run_suite(self):
        try:
            jobs = json.loads(self.suite.toPlainText())
            if not isinstance(jobs, list) or not jobs or len(jobs) > 32:
                raise ValueError("Supply 1–32 configured suite jobs.")
            queue = []
            for job in jobs:
                if not isinstance(job, dict) or not isinstance(job.get("method"), str) or not isinstance(job.get("params"), dict):
                    raise ValueError("Each suite job needs a method string and params object.")
                queue.append((job["method"], job["params"], bool(job.get("attach_design", True))))
            self._suite_queue = queue
            self._suite_results = []
            self._run_next_suite()
        except (ValueError, TypeError) as exc:
            self._fail(exc)

    def _run_next_suite(self):
        if not self._suite_queue:
            self.status.setText(f"Configured suite completed: {len(self._suite_results)} worker responses.")
            self.report.setPlainText(json.dumps(self._suite_results, indent=2, default=str)[:100000])
            return
        method, params, attach = self._suite_queue.pop(0)
        params = dict(params)
        if attach and "design" not in params:
            params["design"] = self._current_design()
        self._call(method, params, lambda result, name=method: self._suite_done(name, result))

    def _suite_done(self, method, result):
        self._suite_results.append({"method": method, "result": result})
        QtCore.QTimer.singleShot(0, self._run_next_suite)


def show_solver_panel():
    global _PANEL
    if _PANEL is None:
        _PANEL = SolverPanel()
    _PANEL.show()
    _PANEL.raise_()
    _PANEL.activateWindow()
    return _PANEL


class OpenSolverPanelCommand:
    def GetResources(self):
        return {"Pixmap": os.path.join(ICON_ROOT, "SolverSuite.svg"),
                "MenuText": "SPIKE Solver Suite...", "ToolTip": "Link a KiCad board and run SPIKE worker analyses"}

    def IsActive(self):
        return True

    def Activated(self):
        show_solver_panel()


class ImportDetailedBoardCommand:
    def GetResources(self):
        return {"Pixmap": os.path.join(ICON_ROOT, "DetailedBoard.svg"),
                "MenuText": "Import detailed KiCad board...",
                "ToolTip": "Import board, copper, and available KiCad component models as STEP"}

    def IsActive(self):
        return True

    def Activated(self):
        show_solver_panel().import_detailed_board()


class ShowResultFieldCommand:
    def GetResources(self):
        return {"Pixmap": os.path.join(ICON_ROOT, "ResultField.svg"),
                "MenuText": "Show SPIKE result field",
                "ToolTip": "Show supplied SPIKE spatial samples in FreeCAD"}

    def IsActive(self):
        return True

    def Activated(self):
        show_solver_panel().show_field()


class ProbeResultCommand:
    def GetResources(self):
        return {"Pixmap": os.path.join(ICON_ROOT, "ProbeResult.svg"),
                "MenuText": "Probe SPIKE result",
                "ToolTip": "Probe the current result at a selected FreeCAD point"}

    def IsActive(self):
        return True

    def Activated(self):
        show_solver_panel().probe_selection()


class OpenHelpCommand:
    def GetResources(self):
        return {"Pixmap": os.path.join(ICON_ROOT, "Help.svg"),
                "MenuText": "SPIKE workbench help...",
                "ToolTip": "Open the searchable setup and simulation guide"}

    def IsActive(self):
        return True

    def Activated(self):
        show_help(Gui.getMainWindow())
