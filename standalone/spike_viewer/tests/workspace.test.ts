// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DockWorkspace } from "../src/workspace/DockWorkspace";
import {
  clampFloatRect,
  createWorkspaceLayout,
  normalizeWorkspaceLayout,
  placeWorkspacePanel,
  recoverWorkspaceLayout,
  resizeFloatRect,
  setWorkspacePanelVisible,
  type WorkspacePanel,
} from "../src/workspace/layoutModel";

const definitions = [
  { id: "assembly", defaultDock: "left" as const },
  { id: "placement", defaultDock: "right" as const },
  { id: "snap", defaultDock: "right" as const },
  { id: "results", defaultDock: "bottom" as const },
];

test("default layout keeps definition order and activates the first panel per dock", () => {
  const layout = createWorkspaceLayout(definitions);
  assert.deepEqual(layout.docks.left.order, ["assembly"]);
  assert.deepEqual(layout.docks.right.order, ["placement", "snap"]);
  assert.equal(layout.docks.left.activeId, "assembly");
  assert.equal(layout.docks.right.activeId, "placement");
  assert.equal(layout.docks.bottom.activeId, "results");
  assert.equal(layout.panels.snap.placement, "right");
  assert.equal(layout.panels.snap.visible, true);
});

test("normalization rejects stale panels and repairs malformed saved state", () => {
  const normalized = normalizeWorkspaceLayout({
    version: 1,
    panels: {
      assembly: { visible: false, placement: "void", float: { x: Infinity, y: 12, width: NaN, height: 30 }, maximized: true, z: -8 },
      placement: { visible: true, placement: "float", float: { x: 20, y: 30, width: 500, height: 400 }, maximized: true, z: 12 },
      removed: { visible: true, placement: "left", float: { x: 0, y: 0, width: 300, height: 200 }, z: 90 },
    },
    docks: {
      left: { size: "wide", order: ["removed", "assembly", "assembly"], activeId: "removed" },
      right: { size: 40, order: ["snap", "unknown"] },
      bottom: { size: 290, order: [] },
    },
    focusedPanelId: "assembly",
    focusViewport: "yes",
    zCounter: NaN,
  }, definitions);

  assert.deepEqual(Object.keys(normalized.panels), ["assembly", "placement", "snap", "results"]);
  assert.equal(normalized.panels.assembly.placement, "left");
  assert.equal(normalized.panels.assembly.maximized, false);
  assert.deepEqual(normalized.panels.assembly.float, { x: 80, y: 12, width: 420, height: 120 });
  assert.equal(normalized.panels.placement.maximized, true);
  assert.equal(normalized.panels.snap.visible, true, "new panels use their current defaults");
  assert.deepEqual(normalized.docks.right.order, ["snap"]);
  assert.equal(normalized.docks.right.size, 160);
  assert.equal(normalized.focusedPanelId, undefined, "hidden panels cannot retain focus");
  assert.equal(normalized.focusViewport, false);
});

test("normalization resets layouts from an unknown schema version", () => {
  const normalized = normalizeWorkspaceLayout({
    version: 2,
    panels: { assembly: { visible: false, placement: "float" } },
  }, definitions);
  assert.deepEqual(normalized, createWorkspaceLayout(definitions));
});

test("floating panels recover into a smaller viewport and tolerate invalid geometry", () => {
  assert.deepEqual(
    clampFloatRect({ x: 900, y: -20, width: Number.NaN, height: 900 }, { width: 500, height: 300 }),
    { x: 80, y: 0, width: 420, height: 300 },
  );
  let layout = createWorkspaceLayout(definitions);
  layout = placeWorkspacePanel(layout, "placement", "float", { x: 700, y: 500, width: 460, height: 380 });
  const recovered = recoverWorkspaceLayout(layout, { width: 360, height: 240 });
  assert.deepEqual(recovered.panels.placement.float, { x: 0, y: 0, width: 360, height: 240 });
  assert.strictEqual(recoverWorkspaceLayout(recovered, { width: 360, height: 240 }), recovered, "stable recovery does not emit redundant state");
});

test("edge and corner resizing clamp without moving the opposite edge", () => {
  const base = { x: 100, y: 80, width: 300, height: 220 };
  assert.deepEqual(resizeFloatRect(base, "w", 260, 0, { width: 600, height: 500 }), { x: 180, y: 80, width: 220, height: 220 });
  assert.deepEqual(resizeFloatRect(base, "e", 900, 0, { width: 600, height: 500 }), { x: 100, y: 80, width: 500, height: 220 });
  assert.deepEqual(resizeFloatRect(base, "nw", -200, -100, { width: 600, height: 500 }), { x: 0, y: 0, width: 400, height: 300 });
  assert.deepEqual(resizeFloatRect(base, "se", -250, -180, { width: 600, height: 500 }), { x: 100, y: 80, width: 220, height: 150 });
});

test("closing an active dock tab selects a peer and reopening restores its dock", () => {
  let layout = createWorkspaceLayout(definitions);
  assert.equal(layout.docks.right.activeId, "placement");
  layout = setWorkspacePanelVisible(layout, "placement", false);
  assert.equal(layout.docks.right.activeId, "snap");
  assert.deepEqual(layout.docks.right.order, ["placement", "snap"]);
  layout = setWorkspacePanelVisible(layout, "placement", true);
  assert.equal(layout.panels.placement.placement, "right");
  assert.equal(layout.docks.right.activeId, "placement");
  assert.deepEqual(layout.docks.right.order, ["placement", "snap"]);
});

test("workspace server markup exposes controls while keeping every panel and viewport mounted", () => {
  const panels: WorkspacePanel[] = [
    { id: "assembly", title: "Assembly", defaultDock: "left", content: createElement("input", { "aria-label": "assembly draft", defaultValue: "draft A" }) },
    { id: "placement", title: "Placement", defaultDock: "right", content: createElement("p", null, "placement content") },
    { id: "snap", title: "Snap & align", defaultDock: "right", content: createElement("p", null, "snap content") },
  ];
  const layout = setWorkspacePanelVisible(createWorkspaceLayout(panels), "snap", false);
  const html = renderToStaticMarkup(createElement(DockWorkspace, {
    panels,
    layout,
    onLayoutChange: () => undefined,
    compact: true,
  }, createElement("div", { id: "viewport-sentinel" }, "viewport")));

  assert.match(html, /aria-label="Workspace panels"/);
  assert.match(html, /aria-label="Open or focus panel"/);
  assert.match(html, /Reopen Snap &amp; align/);
  assert.match(html, /aria-label="Workspace viewport"/);
  assert.match(html, /id="viewport-sentinel"/);
  assert.match(html, /aria-label="Panel launcher"/);
  assert.doesNotMatch(html, /drawer"/, "compact mode starts with its drawer closed");
  assert.equal((html.match(/assembly draft/g) ?? []).length, 1);
  assert.equal((html.match(/placement content/g) ?? []).length, 1);
  assert.equal((html.match(/snap content/g) ?? []).length, 1, "closed contents remain mounted in parking");
});
