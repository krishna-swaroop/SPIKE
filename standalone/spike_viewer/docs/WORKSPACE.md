# Workspace panels

Version 0.3 adds `DockWorkspace` to both standalone labs. Assembly studio groups
imports and occurrences under Assembly, transforms under Placement, movement
and snapping under Snap & align, and display controls under View & results.
Virtual data lab has Virtual layers, Inspect sample, and View & data panels.
Essential view and edit controls remain above the viewport.

## Arrange panels

- Drag a title or dock tab into the workspace to float the panel. Drag toward
  the left, right or bottom edge to dock it; a highlighted area previews the
  destination. A click without movement selects the panel.
- Use the title's placement menu for Left, Right, Bottom or Float. Panels at
  the same edge form a tab group. Tabs scroll when they exceed the dock width.
- Resize a floating panel from its edges/corners; resize a dock using its
  divider. Float titles support arrow keys (4 px, or 20 px with Shift), as do
  their resize handles. Dock divider arrows use 8 px or 32 px with Shift.
- Max/Restore expands a floating panel to the workspace and recovers its size.
  The close button hides a panel; the Panel menu reopens or focuses it.
- Focus viewport temporarily hides panels. Show panels restores them. Reset
  layout resets only the arrangement, preserving authored scene/result data.

Panels keep their React state while moving, docking, switching tabs, hiding,
and reopening. The center viewer remains mounted through layout changes, so
camera and selection are retained. Resizing changes the available canvas area;
use Fit all/Fit board when you want to reframe it. Assembly perspective fitting
uses the limiting horizontal or vertical field of view, including portrait screens.

## Small screens

A workspace below 1000 CSS pixels wide or 600 pixels high uses a compact layout.
The bottom launcher opens one scrollable panel drawer at a time. Close drawer
or Escape dismisses it and returns to the viewport. Closing the panel with its
title button instead hides it from the launcher; reopen it through Panel.
The desktop arrangement returns when space is available. Entering compact mode
does not overwrite desktop floating sizes and positions. Desktop resize clamps
panels into the available workspace so their controls remain reachable.
Short landscape displays use a side drawer so the scene remains visible beside it.

Essential controls wrap, forms scroll within drawers, and compact buttons have
larger touch targets. Small-screen support does not imply tested native touch
gizmo interaction on every device.

## Embed the workspace

```tsx
import { useState } from "react";
import { DockWorkspace, createWorkspaceLayout, type WorkspacePanel }
  from "@spike/board-viewer";
import "@spike/board-viewer/style.css";

const definitions = [{ id: "results", defaultDock: "right" }] as const;

function ViewerWorkspace() {
  const [layout, setLayout] = useState(() => createWorkspaceLayout(definitions));
  const panels: WorkspacePanel[] = [{
    ...definitions[0], title: "Results", content: <ResultsPanel />,
  }];
  return <div style={{ height: "100dvh" }}>
    <DockWorkspace panels={panels} layout={layout} onLayoutChange={setLayout}>
      <YourViewer />
    </DockWorkspace>
  </div>;
}
```

Use unique stable panel IDs and keep the center child's identity stable. Supply
an explicit `compact` boolean to override automatic sizing; `onCompactChange`
reports the effective mode. The component requires a DOM/ResizeObserver for
interactive rendering. Server rendering can expose content but is not a
qualified hydration workflow.

`WorkspaceLayout` version 1 is display preference data: panel visibility,
placement, floating rectangles, dock sizes/order/active tabs and viewport focus.
`normalizeWorkspaceLayout(saved, definitions)` admits known panel IDs and
recovers malformed/unsupported stored layouts. Always normalize external data
before passing it to the component. The core does not access storage or files.

The demo host stores each lab's normalized layout separately in localStorage,
under `spike-viewer:workspace:<lab>:v1`. It catches blocked/quota storage, rejects
oversized or malformed JSON, shows a save warning, and remains usable. Layouts
do not contain board geometry, result data, or unfinished form edits. Assembly
save/open remains a separate explicit operation; reload preserves layout only.

## Scope and limits

This is an original SPIKE React/CSS workspace implementation with no added
docking dependency. Windows float inside the application workspace. Native
detached OS windows, multi-monitor layouts, arbitrary nested split trees,
persistent CAD mates and production SPIKE integration remain separate work.
The existing React/Three and optional OCCT dependency notices still apply.
