// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";

export type DockEdge = "left" | "right" | "bottom";
export type PanelPlacement = DockEdge | "float";
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type WorkspaceBounds = { width: number; height: number };
export type FloatRect = { x: number; y: number; width: number; height: number };

export type WorkspacePanel = {
  id: string;
  title: string;
  content: ReactNode;
  defaultDock: DockEdge;
};

export type WorkspacePanelDefinition = Pick<WorkspacePanel, "id" | "defaultDock"> | string;

export type WorkspacePanelLayout = {
  visible: boolean;
  placement: PanelPlacement;
  float: FloatRect;
  restoreFloat?: FloatRect;
  maximized: boolean;
  z: number;
};

export type WorkspaceDockLayout = {
  size: number;
  order: string[];
  activeId?: string;
};

export type WorkspaceLayout = {
  version: 1;
  panels: Record<string, WorkspacePanelLayout>;
  docks: Record<DockEdge, WorkspaceDockLayout>;
  focusedPanelId?: string;
  focusViewport: boolean;
  zCounter: number;
};

const EDGES: DockEdge[] = ["left", "right", "bottom"];
const DEFAULT_SIZE: Record<DockEdge, number> = { left: 300, right: 320, bottom: 260 };
const DEFAULT_FLOAT: FloatRect = { x: 80, y: 56, width: 420, height: 320 };

function definition(value: WorkspacePanelDefinition): { id: string; defaultDock: DockEdge } {
  return typeof value === "string" ? { id: value, defaultDock: "right" } : value;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function floatRect(value: unknown, fallback: FloatRect): FloatRect {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    x: finite(record.x, fallback.x),
    y: finite(record.y, fallback.y),
    width: Math.max(180, finite(record.width, fallback.width)),
    height: Math.max(120, finite(record.height, fallback.height)),
  };
}

export function createWorkspaceLayout(definitions: readonly WorkspacePanelDefinition[]): WorkspaceLayout {
  const panels: Record<string, WorkspacePanelLayout> = {};
  const docks = Object.fromEntries(EDGES.map(edge => [edge, { size: DEFAULT_SIZE[edge], order: [] as string[] }])) as Record<DockEdge, WorkspaceDockLayout>;
  let z = 1;
  definitions.map(definition).forEach((panel, index) => {
    if (!panel.id || panels[panel.id]) return;
    const offset = index * 24;
    panels[panel.id] = {
      visible: true,
      placement: panel.defaultDock,
      float: { ...DEFAULT_FLOAT, x: DEFAULT_FLOAT.x + offset, y: DEFAULT_FLOAT.y + offset },
      maximized: false,
      z: z++,
    };
    docks[panel.defaultDock].order.push(panel.id);
    docks[panel.defaultDock].activeId ??= panel.id;
  });
  return { version: 1, panels, docks, focusViewport: false, zCounter: z };
}

export function normalizeWorkspaceLayout(saved: unknown, definitions: readonly WorkspacePanelDefinition[]): WorkspaceLayout {
  const fallback = createWorkspaceLayout(definitions);
  if (!saved || typeof saved !== "object") return fallback;
  const source = saved as Record<string, unknown>;
  if (source.version !== 1) return fallback;
  const savedPanels = source.panels && typeof source.panels === "object" ? source.panels as Record<string, unknown> : {};
  const panels: Record<string, WorkspacePanelLayout> = {};
  let maximumZ = 0;
  definitions.map(definition).forEach((panel, index) => {
    if (!panel.id || panels[panel.id]) return;
    const base = fallback.panels[panel.id];
    const value = savedPanels[panel.id] && typeof savedPanels[panel.id] === "object"
      ? savedPanels[panel.id] as Record<string, unknown> : {};
    const placement = ["left", "right", "bottom", "float"].includes(String(value.placement))
      ? value.placement as PanelPlacement : base.placement;
    const state: WorkspacePanelLayout = {
      visible: typeof value.visible === "boolean" ? value.visible : base.visible,
      placement,
      float: floatRect(value.float, base.float),
      maximized: placement === "float" && value.maximized === true,
      z: Math.max(1, Math.floor(finite(value.z, index + 1))),
    };
    if (value.restoreFloat) state.restoreFloat = floatRect(value.restoreFloat, state.float);
    panels[panel.id] = state;
    maximumZ = Math.max(maximumZ, state.z);
  });

  const savedDocks = source.docks && typeof source.docks === "object" ? source.docks as Record<string, unknown> : {};
  const docks = {} as Record<DockEdge, WorkspaceDockLayout>;
  for (const edge of EDGES) {
    const value = savedDocks[edge] && typeof savedDocks[edge] === "object" ? savedDocks[edge] as Record<string, unknown> : {};
    const requested = Array.isArray(value.order) ? value.order.filter(id => typeof id === "string") as string[] : [];
    const assigned = Object.keys(panels).filter(id => panels[id].placement === edge);
    const order = [...new Set([...requested.filter(id => assigned.includes(id)), ...assigned])];
    const activeId = typeof value.activeId === "string" && order.includes(value.activeId) && panels[value.activeId].visible
      ? value.activeId : order.find(id => panels[id].visible);
    docks[edge] = {
      size: Math.max(160, finite(value.size, DEFAULT_SIZE[edge])),
      order,
      ...(activeId ? { activeId } : {}),
    };
  }
  const focusedPanelId = typeof source.focusedPanelId === "string" && panels[source.focusedPanelId]?.visible
    ? source.focusedPanelId : undefined;
  return {
    version: 1,
    panels,
    docks,
    ...(focusedPanelId ? { focusedPanelId } : {}),
    focusViewport: source.focusViewport === true,
    zCounter: Math.max(maximumZ, Math.floor(finite(source.zCounter, maximumZ))),
  };
}

export function clampFloatRect(rect: FloatRect, bounds: WorkspaceBounds): FloatRect {
  const widthLimit = Math.max(1, finite(bounds.width, 1));
  const heightLimit = Math.max(1, finite(bounds.height, 1));
  const width = Math.min(Math.max(Math.min(220, widthLimit), finite(rect.width, DEFAULT_FLOAT.width)), widthLimit);
  const height = Math.min(Math.max(Math.min(150, heightLimit), finite(rect.height, DEFAULT_FLOAT.height)), heightLimit);
  return {
    x: Math.max(0, Math.min(finite(rect.x, 0), Math.max(0, widthLimit - width))),
    y: Math.max(0, Math.min(finite(rect.y, 0), Math.max(0, heightLimit - height))),
    width,
    height,
  };
}

export function recoverWorkspaceLayout(layout: WorkspaceLayout, bounds: WorkspaceBounds): WorkspaceLayout {
  let changed = false;
  const panels = Object.fromEntries(Object.entries(layout.panels).map(([id, panel]) => {
    const nextFloat = clampFloatRect(panel.float, bounds);
    const nextRestore = panel.restoreFloat ? clampFloatRect(panel.restoreFloat, bounds) : undefined;
    if (JSON.stringify(nextFloat) !== JSON.stringify(panel.float)
      || JSON.stringify(nextRestore) !== JSON.stringify(panel.restoreFloat)) changed = true;
    return [id, { ...panel, float: nextFloat, ...(nextRestore ? { restoreFloat: nextRestore } : {}) }];
  }));
  return changed ? { ...layout, panels } : layout;
}

export function resizeFloatRect(rect: FloatRect, handle: ResizeHandle, dx: number, dy: number, bounds: WorkspaceBounds): FloatRect {
  const base = clampFloatRect(rect, bounds);
  const widthLimit = Math.max(1, finite(bounds.width, 1));
  const heightLimit = Math.max(1, finite(bounds.height, 1));
  const minWidth = Math.min(220, widthLimit);
  const minHeight = Math.min(150, heightLimit);
  const deltaX = finite(dx, 0);
  const deltaY = finite(dy, 0);
  let { x, y, width, height } = base;
  if (handle.includes("e")) width = Math.max(minWidth, Math.min(width + deltaX, widthLimit - x));
  if (handle.includes("s")) height = Math.max(minHeight, Math.min(height + deltaY, heightLimit - y));
  if (handle.includes("w")) {
    const right = x + width;
    x = Math.max(0, Math.min(x + deltaX, right - minWidth));
    width = right - x;
  }
  if (handle.includes("n")) {
    const bottom = y + height;
    y = Math.max(0, Math.min(y + deltaY, bottom - minHeight));
    height = bottom - y;
  }
  return { x, y, width, height };
}

function removeFromDocks(layout: WorkspaceLayout, id: string): WorkspaceLayout["docks"] {
  return Object.fromEntries(EDGES.map(edge => {
    const dock = layout.docks[edge];
    const order = dock.order.filter(value => value !== id);
    const activeId = dock.activeId === id ? order.find(value => layout.panels[value]?.visible) : dock.activeId;
    return [edge, { size: dock.size, order, ...(activeId ? { activeId } : {}) }];
  })) as WorkspaceLayout["docks"];
}

export function placeWorkspacePanel(layout: WorkspaceLayout, id: string, placement: PanelPlacement, rect?: FloatRect): WorkspaceLayout {
  const panel = layout.panels[id];
  if (!panel) return layout;
  const docks = removeFromDocks(layout, id);
  if (placement !== "float") {
    docks[placement] = { ...docks[placement], order: [...docks[placement].order, id], activeId: id };
  }
  const z = layout.zCounter + 1;
  return {
    ...layout,
    panels: { ...layout.panels, [id]: { ...panel, visible: true, placement, maximized: false, ...(rect ? { float: rect } : {}), z } },
    docks,
    focusedPanelId: id,
    zCounter: z,
  };
}

export function setWorkspacePanelVisible(layout: WorkspaceLayout, id: string, visible: boolean): WorkspaceLayout {
  const panel = layout.panels[id];
  if (!panel || panel.visible === visible) return layout;
  const panels = { ...layout.panels, [id]: { ...panel, visible } };
  const docks = Object.fromEntries(EDGES.map(edge => {
    const dock = layout.docks[edge];
    const activeId = visible && panel.placement === edge ? id
      : dock.activeId === id && !visible ? dock.order.find(value => panels[value]?.visible) : dock.activeId;
    return [edge, { size: dock.size, order: dock.order, ...(activeId ? { activeId } : {}) }];
  })) as WorkspaceLayout["docks"];
  return { ...layout, panels, docks, focusedPanelId: visible ? id : layout.focusedPanelId === id ? undefined : layout.focusedPanelId };
}

export function activateWorkspacePanel(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  const panel = layout.panels[id];
  if (!panel) return layout;
  const z = layout.zCounter + 1;
  const docks = panel.placement === "float" ? layout.docks : {
    ...layout.docks,
    [panel.placement]: { ...layout.docks[panel.placement], activeId: id },
  };
  return { ...layout, panels: { ...layout.panels, [id]: { ...panel, z } }, docks, focusedPanelId: id, zCounter: z };
}

export function setWorkspaceDockSize(layout: WorkspaceLayout, edge: DockEdge, size: number): WorkspaceLayout {
  return { ...layout, docks: { ...layout.docks, [edge]: { ...layout.docks[edge], size: Math.max(160, finite(size, layout.docks[edge].size)) } } };
}
