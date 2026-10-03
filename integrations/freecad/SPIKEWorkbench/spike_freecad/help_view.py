# SPDX-License-Identifier: MIT
"""Searchable, local help for the FreeCAD SPIKE workbench."""

from __future__ import annotations

import re
from pathlib import Path

try:
    from PySide import QtCore, QtGui, QtWidgets
except ImportError:
    try:
        from PySide6 import QtCore, QtGui, QtWidgets
    except ImportError:
        from PySide import QtCore, QtGui
        QtWidgets = QtGui


GUIDE = Path(__file__).resolve().parents[1] / "docs" / "USER_GUIDE.md"
README = Path(__file__).resolve().parents[1] / "README.md"
_HELP = None


def guide_sections(markdown):
    """Return level-one and level-two headings with their document offsets."""
    return [(match.group(2).strip(), match.start())
            for match in re.finditer(r"(?m)^(#{1,2})\s+(.+?)\s*$", markdown)]


class HelpDialog(QtWidgets.QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("SPIKE workbench · Help")
        self.resize(1000, 700)
        self.setObjectName("SPIKEHelp")
        self.setStyleSheet("""
            #SPIKEHelp { background: #202a35; color: #e5edf4; }
            #SPIKEHelp QLabel { color: #e5edf4; }
            #SPIKEHelp QLineEdit, #SPIKEHelp QListWidget { background: #243747;
                color: #e5edf4; border: 1px solid #637a8e; padding: 4px; }
            #SPIKEHelp QTextBrowser { background: #f7fafc; color: #1d2e3a;
                border: 1px solid #637a8e; padding: 8px; }
            #SPIKEHelp QPushButton { background: #354b5e; color: #e5edf4;
                border: 1px solid #617b8e; border-radius: 4px; padding: 6px 12px; }
        """)
        path = GUIDE if GUIDE.is_file() else README
        self._markdown = path.read_text(encoding="utf-8")
        outer = QtWidgets.QVBoxLayout(self)
        top = QtWidgets.QHBoxLayout()
        self.search = QtWidgets.QLineEdit()
        self.search.setPlaceholderText("Search help text")
        self.search.returnPressed.connect(self.find_next)
        top.addWidget(self.search, 1)
        find = QtWidgets.QPushButton("Find next")
        find.clicked.connect(self.find_next)
        top.addWidget(find)
        outer.addLayout(top)
        split = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        self.topics = QtWidgets.QListWidget()
        self.topics.setMinimumWidth(240)
        self.topics.setMaximumWidth(330)
        for title, offset in guide_sections(self._markdown):
            item = QtWidgets.QListWidgetItem(title)
            item.setData(QtCore.Qt.UserRole, offset)
            self.topics.addItem(item)
        self.topics.currentItemChanged.connect(self.go_to_topic)
        split.addWidget(self.topics)
        self.browser = QtWidgets.QTextBrowser()
        self.browser.document().setBaseUrl(QtCore.QUrl.fromLocalFile(str(path.parent.resolve()) + "/"))
        if hasattr(self.browser, "setMarkdown"):
            self.browser.setMarkdown(self._markdown)
        else:
            self.browser.setPlainText(self._markdown)
        self.browser.setOpenExternalLinks(True)
        split.addWidget(self.browser)
        split.setStretchFactor(1, 1)
        outer.addWidget(split, 1)
        bottom = QtWidgets.QHBoxLayout()
        bottom.addWidget(QtWidgets.QLabel("Local guide · F1 opens this window from the solver panel"))
        bottom.addStretch()
        close = QtWidgets.QPushButton("Close")
        close.clicked.connect(self.close)
        bottom.addWidget(close)
        outer.addLayout(bottom)

    def go_to_topic(self, item, _previous=None):
        if item is None:
            return
        title = item.text()
        cursor = self.browser.document().find(title)
        if not cursor.isNull():
            self.browser.setTextCursor(cursor)
            self.browser.ensureCursorVisible()

    def find_next(self):
        needle = self.search.text().strip()
        if needle and not self.browser.find(needle):
            self.browser.moveCursor(QtGui.QTextCursor.Start)
            self.browser.find(needle)


def show_help(parent=None):
    global _HELP
    if _HELP is None:
        _HELP = HelpDialog(parent)
    _HELP.show()
    _HELP.raise_()
    _HELP.activateWindow()
    return _HELP
