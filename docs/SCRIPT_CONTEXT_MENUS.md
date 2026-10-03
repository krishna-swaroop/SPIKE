# Context menus and script drafts

Viewport objects and scene search objects offer selection-aware actions such as
probes, net isolation, metadata copy and **Open in script**. The object menu's
task action follows the active workspace. Plot menus open the displayed source
traces and comparisons in a script; table menus copy a cell/row or open a row or
visible page. Right-click opens a menu; Shift+F10 or the Context Menu key opens
supported focused controls. Use Arrow keys, Home/End, Enter and Escape to navigate.
Browser context menus remain suppressed by the native WebView guards.

**Open in script** creates an unsaved Python tab. It does not run code, save a
file, alter geometry or admit a solver result. The draft contains an immutable
JSON snapshot encoded as base64, plus references to `spike.design` and
`spike.results` when it is run. These current inputs may differ from the earlier
snapshot. Review the tab and explicitly choose Run.

Selection snapshots retain object identity and the current board occurrence.
Object positions use PCB source millimetres. Optional orbit focus points are
labelled as centered, Y-inverted, render-scaled scene coordinates and must not be
used as board coordinates. Plot snapshots retain their revision, axis labels,
sample arrays and comparison identity; null denotes a missing/nonfinite gap.
Table snapshots contain displayed strings and current editor values from the
chosen row/page, including headings and page scope. They are not canonical
data exports and can contain rounded display values.

Snapshots are limited to 240,000 UTF-8 bytes. Plot snapshots additionally allow
30,000 array entries, and table page snapshots allow 500 rows. Oversized contexts
report an error without truncating samples. Export source data or select a
smaller context. Script tabs retain the workspace's own byte/tab limits, save
states, explicit execution and recovery behavior.

The internal event `spike-open-context-script` carries a bounded
`{id, name, code}` draft to `App`; it is not an execution command. Ownership is
`contextScript.ts`, `ActionContextMenu.tsx`, `contextMenuTrigger.ts`, and
`tableContext.ts`. Domain adapters still own validation, precision, provenance,
units and writes. `npm run test:context-menus` checks Unicode/injection-safe
draft encoding, exact values and units, size rejection, keyboard triggers and
current table editor values.
