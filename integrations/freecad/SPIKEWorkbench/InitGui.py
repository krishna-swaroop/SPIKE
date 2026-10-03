# SPDX-License-Identifier: MIT
"""FreeCAD GUI entry point for the SPIKE companion workbench."""

import FreeCADGui as Gui


class SPIKEWorkbench(Workbench):  # type: ignore[name-defined]  # FreeCAD injects Workbench.
    """KiCad link, solver worker, and ECAD/MCAD exchange workbench."""

    MenuText = "SPIKE"
    ToolTip = "Link KiCad, run SPIKE analyses, and exchange geometry"
    # FreeCAD executes InitGui.py with separate globals and locals. Class
    # attributes cannot depend on names imported at module scope here.
    Icon = ""

    def Initialize(self):
        from spike_freecad.commands import COMMAND_IDS, register_commands

        register_commands()
        self._commands = list(COMMAND_IDS)
        self.appendToolbar("SPIKE Geometry", self._commands[:6] + [self._commands[7]])
        self.appendToolbar("SPIKE Simulations", [self._commands[6], self._commands[10]])
        self.appendToolbar("SPIKE Results", self._commands[8:10])
        self.appendMenu("SPIKE", self._commands)

    def Activated(self):
        return None

    def Deactivated(self):
        return None

    def ContextMenu(self, recipient):
        del recipient
        self.appendContextMenu("SPIKE", self._commands)

    def GetClassName(self):
        return "Gui::PythonWorkbench"


Gui.addWorkbench(SPIKEWorkbench())
