// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  activateWorkspacePanel,
  clampFloatRect,
  createWorkspaceLayout,
  placeWorkspacePanel,
  recoverWorkspaceLayout,
  resizeFloatRect,
  setWorkspaceDockSize,
  setWorkspacePanelVisible,
  type DockEdge,
  type FloatRect,
  type PanelPlacement,
  type ResizeHandle,
  type WorkspaceBounds,
  type WorkspaceLayout,
  type WorkspacePanel,
} from "./layoutModel";
import "./workspace.css";

export type DockWorkspaceProps = {
  panels: readonly WorkspacePanel[];
  children: ReactNode;
  layout: WorkspaceLayout;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
};

type MoveInteraction = {
  kind: "move"; id: string; startX: number; startY: number;
  base: WorkspaceLayout; rect: FloatRect; lastRect: FloatRect; wasFloating: boolean; dragged: boolean;
};
type ResizeInteraction = {
  kind: "resize"; id: string; handle: ResizeHandle; startX: number; startY: number;
  base: WorkspaceLayout; rect: FloatRect;
};
type SplitInteraction = { kind: "split"; edge: DockEdge; startX: number; startY: number; size: number; base: WorkspaceLayout };
type Interaction = MoveInteraction | ResizeInteraction | SplitInteraction;

const EDGES: DockEdge[] = ["left", "right", "bottom"];
const HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function dropEdge(x: number, y: number, bounds: WorkspaceBounds): DockEdge | null {
  const side = Math.min(150, bounds.width * 0.18);
  const bottom = Math.min(150, bounds.height * 0.23);
  if (x <= side) return "left";
  if (x >= bounds.width - side) return "right";
  if (y >= bounds.height - bottom) return "bottom";
  return null;
}

function dockSizeLimit(edge: DockEdge, bounds: WorkspaceBounds): number {
  return edge === "bottom" ? Math.max(160, bounds.height * 0.58) : Math.max(180, bounds.width * 0.44);
}

export function DockWorkspace({ panels, children, layout, onLayoutChange, compact, onCompactChange }: DockWorkspaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<HTMLSelectElement>(null);
  const launcherRefs = useRef(new Map<string, HTMLButtonElement>());
  const headerRefs = useRef(new Map<string, HTMLElement>());
  const placementRefs = useRef(new Map<string, HTMLSelectElement>());
  const hostsRef = useRef(new Map<string, HTMLDivElement>());
  const interactionRef = useRef<Interaction | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [bounds, setBounds] = useState<WorkspaceBounds>({ width: 1000, height: 700 });
  const [autoCompact, setAutoCompact] = useState(false);
  const [compactActiveId, setCompactActiveId] = useState<string | null>(null);
  const [dropPreview, setDropPreview] = useState<DockEdge | null>(null);
  const [managerValue, setManagerValue] = useState("");
  const effectiveCompact = compact ?? autoCompact;
  const panelById = new Map(panels.map(panel => [panel.id, panel]));

  if (typeof document !== "undefined") for (const panel of panels) {
    if (!hostsRef.current.has(panel.id)) {
      const host = document.createElement("div");
      host.className = "dock-workspace__panel-content-root";
      hostsRef.current.set(panel.id, host);
    }
  }

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const update = () => {
      const rootRect = root.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const nextBounds = { width: Math.max(1, stageRect.width), height: Math.max(1, stageRect.height) };
      const nextAutoCompact = rootRect.width < 1000 || rootRect.height < 600;
      setBounds(nextBounds);
      setAutoCompact(nextAutoCompact);
      // Compact mode renders desktop floats as a drawer. Do not persist its
      // narrow measurement over the user's desktop positions.
      if (!(compact ?? nextAutoCompact)) {
        const recovered = recoverWorkspaceLayout(layoutRef.current, nextBounds);
        if (recovered !== layoutRef.current) onLayoutChange(recovered);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    update();
    return () => observer.disconnect();
  }, [compact, onLayoutChange]);

  const previousCompact = useRef<boolean>();
  useEffect(() => {
    if (previousCompact.current !== effectiveCompact) {
      previousCompact.current = effectiveCompact;
      setCompactActiveId(null);
      onCompactChange?.(effectiveCompact);
    }
  }, [effectiveCompact, onCompactChange]);

  const emit = (next: WorkspaceLayout) => {
    layoutRef.current = next;
    onLayoutChange(next);
  };

  const mountContent = (panel: WorkspacePanel, className = "dock-workspace__panel-content") => {
    const host = hostsRef.current.get(panel.id);
    return <div className={className} data-panel-content={panel.id} ref={node => {
      if (node && host && host.parentElement !== node) {
        const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
        node.appendChild(host);
        focused?.focus({ preventScroll: true });
      }
    }}>
      {!host ? panel.content : null}
    </div>;
  };

  const closePanel = (id: string) => {
    emit(setWorkspacePanelVisible(layoutRef.current, id, false));
    if (compactActiveId === id) {
      setCompactActiveId(null);
    }
    requestAnimationFrame(() => managerRef.current?.focus());
  };

  const dismissDrawer = () => {
    const id = compactActiveId;
    setCompactActiveId(null);
    requestAnimationFrame(() => (id ? launcherRefs.current.get(id) : managerRef.current)?.focus());
  };

  const setPlacement = (id: string, placement: PanelPlacement) => {
    const panel = layoutRef.current.panels[id];
    if (!panel) return;
    emit(placeWorkspacePanel(layoutRef.current, id, placement,
      placement === "float" ? clampFloatRect(panel.float, bounds) : undefined));
    requestAnimationFrame(() => placementRefs.current.get(id)?.focus({ preventScroll: true }));
  };

  const toggleMaximize = (id: string) => {
    const current = layoutRef.current;
    const panel = current.panels[id];
    if (!panel || panel.placement !== "float") return;
    const next = panel.maximized
      ? { ...panel, maximized: false, float: panel.restoreFloat ?? panel.float, restoreFloat: undefined }
      : { ...panel, maximized: true, restoreFloat: panel.float };
    emit({ ...current, panels: { ...current.panels, [id]: next }, focusedPanelId: id });
  };

  const beginMove = (event: PointerEvent<HTMLElement>, id: string) => {
    const interactive = (event.target as HTMLElement).closest("button,select,input,textarea,a");
    if (effectiveCompact || event.button !== 0 || (interactive && interactive !== event.currentTarget)) return;
    const panel = layoutRef.current.panels[id];
    if (!panel || panel.maximized) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = activateWorkspacePanel(layoutRef.current, id);
    const rect = panel.placement === "float" ? panel.float : clampFloatRect({
      x: event.clientX - (stageRef.current?.getBoundingClientRect().left ?? 0) - 120,
      y: event.clientY - (stageRef.current?.getBoundingClientRect().top ?? 0) - 18,
      width: 360, height: 300,
    }, bounds);
    interactionRef.current = {
      kind: "move", id, startX: event.clientX, startY: event.clientY,
      base, rect, lastRect: rect, wasFloating: panel.placement === "float", dragged: false,
    };
    emit(base);
  };

  const beginResize = (event: PointerEvent<HTMLElement>, id: string, handle: ResizeHandle) => {
    const panel = layoutRef.current.panels[id];
    if (event.button !== 0 || !panel || panel.placement !== "float" || panel.maximized) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = activateWorkspacePanel(layoutRef.current, id);
    interactionRef.current = { kind: "resize", id, handle, startX: event.clientX, startY: event.clientY, base, rect: panel.float };
    emit(base);
  };

  const beginSplit = (event: PointerEvent<HTMLElement>, edge: DockEdge) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = { kind: "split", edge, startX: event.clientX, startY: event.clientY, size: layoutRef.current.docks[edge].size, base: layoutRef.current };
  };

  const moveInteraction = (event: PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.kind === "move") {
      if (!interaction.dragged && Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY) < 5) return;
      interaction.dragged = true;
      const rect = clampFloatRect({ ...interaction.rect, x: interaction.rect.x + event.clientX - interaction.startX, y: interaction.rect.y + event.clientY - interaction.startY }, bounds);
      interaction.lastRect = rect;
      const stage = stageRef.current?.getBoundingClientRect();
      const edge = stage ? dropEdge(event.clientX - stage.left, event.clientY - stage.top, bounds) : null;
      setDropPreview(edge);
      // Keep a dock tab/title mounted while it owns pointer capture. It is
      // converted to a float (or another dock) when the pointer is released.
      if (interaction.wasFloating) emit(placeWorkspacePanel(interaction.base, interaction.id, "float", rect));
    } else if (interaction.kind === "resize") {
      const rect = resizeFloatRect(interaction.rect, interaction.handle, event.clientX - interaction.startX, event.clientY - interaction.startY, bounds);
      emit({ ...interaction.base, panels: { ...interaction.base.panels, [interaction.id]: { ...interaction.base.panels[interaction.id], float: rect } } });
    } else {
      const delta = interaction.edge === "left" ? event.clientX - interaction.startX
        : interaction.edge === "right" ? interaction.startX - event.clientX : interaction.startY - event.clientY;
      const size = Math.min(dockSizeLimit(interaction.edge, bounds), interaction.size + delta);
      emit(setWorkspaceDockSize(interaction.base, interaction.edge, size));
    }
  };

  const endInteraction = (event: PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (interaction?.kind === "move" && interaction.dragged) {
      const stage = stageRef.current?.getBoundingClientRect();
      const edge = stage ? dropEdge(event.clientX - stage.left, event.clientY - stage.top, bounds) : null;
      emit(placeWorkspacePanel(interaction.base, interaction.id, edge ?? "float", edge ? undefined : interaction.lastRect));
      requestAnimationFrame(() => headerRefs.current.get(interaction.id)?.focus({ preventScroll: true }));
    }
    setDropPreview(null);
  };

  const cancelInteraction = (event: PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (interaction && (interaction.kind !== "move" || interaction.dragged)) emit(interaction.base);
    setDropPreview(null);
  };

  const moveByKeyboard = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (!event.key.startsWith("Arrow")) return;
    const panel = layoutRef.current.panels[id];
    if (!panel || panel.placement !== "float") return;
    event.preventDefault();
    const step = event.shiftKey ? 20 : 4;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    const next = activateWorkspacePanel(layoutRef.current, id);
    emit({ ...next, panels: { ...next.panels, [id]: { ...next.panels[id], float: clampFloatRect({ ...panel.float, x: panel.float.x + dx, y: panel.float.y + dy }, bounds) } } });
  };

  const resizeByKeyboard = (event: KeyboardEvent<HTMLElement>, id: string, handle: ResizeHandle) => {
    if (!event.key.startsWith("Arrow")) return;
    const panel = layoutRef.current.panels[id];
    if (!panel) return;
    event.preventDefault();
    const step = event.shiftKey ? 20 : 4;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    emit({ ...layoutRef.current, panels: { ...layoutRef.current.panels, [id]: { ...panel, float: resizeFloatRect(panel.float, handle, dx, dy, bounds) } } });
  };

  const resizeDockByKeyboard = (event: KeyboardEvent<HTMLElement>, edge: DockEdge) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const direction = edge === "left"
      ? (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)
      : edge === "right"
        ? (event.key === "ArrowLeft" ? 1 : event.key === "ArrowRight" ? -1 : 0)
        : (event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0);
    if (!direction) return;
    const nextSize = Math.min(dockSizeLimit(edge, bounds), layoutRef.current.docks[edge].size + step * direction);
    emit(setWorkspaceDockSize(layoutRef.current, edge, nextSize));
  };

  const header = (panel: WorkspacePanel, floating: boolean) => <header className="dock-workspace__panel-header"
    ref={node => { if (node) headerRefs.current.set(panel.id, node); else headerRefs.current.delete(panel.id); }}
    tabIndex={0} aria-label={`Move ${panel.title}`}
    onPointerDown={event => beginMove(event, panel.id)} onPointerMove={moveInteraction} onPointerUp={endInteraction}
    onPointerCancel={cancelInteraction} onKeyDown={event => event.target === event.currentTarget && floating && !effectiveCompact && moveByKeyboard(event, panel.id)}>
    <strong title={panel.title}>{panel.title}</strong>
    <label><span className="dock-workspace__sr-only">Place {panel.title}</span><select aria-label={`Place ${panel.title}`}
      ref={node => { if (node) placementRefs.current.set(panel.id, node); else placementRefs.current.delete(panel.id); }}
      value={layout.panels[panel.id]?.placement ?? panel.defaultDock} onChange={event => setPlacement(panel.id, event.target.value as PanelPlacement)}>
      <option value="left">Left</option><option value="right">Right</option><option value="bottom">Bottom</option><option value="float">Float</option>
    </select></label>
    {floating && <button type="button" onClick={() => toggleMaximize(panel.id)} aria-label={`${layout.panels[panel.id]?.maximized ? "Restore" : "Maximize"} ${panel.title}`}>
      {layout.panels[panel.id]?.maximized ? "Restore" : "Max"}
    </button>}
    <button type="button" onClick={() => closePanel(panel.id)} aria-label={`Close ${panel.title}`}>×</button>
  </header>;

  const panelShell = (panel: WorkspacePanel, floating: boolean) => <section key={panel.id}
    className={`dock-workspace__panel ${floating ? "dock-workspace__panel--floating" : ""}`} data-panel-shell={panel.id}
    aria-label={panel.title} onPointerDown={() => emit(activateWorkspacePanel(layoutRef.current, panel.id))}>
    {header(panel, floating)}
    {mountContent(panel)}
    {floating && HANDLES.map(handle => <div key={handle} className={`dock-workspace__resize dock-workspace__resize--${handle}`}
      role="separator" tabIndex={0} aria-label={`Resize ${panel.title} ${handle}`}
          onPointerDown={event => beginResize(event, panel.id, handle)} onPointerMove={moveInteraction}
      onPointerUp={endInteraction} onPointerCancel={cancelInteraction}
      onKeyDown={event => resizeByKeyboard(event, panel.id, handle)} />)}
  </section>;

  const dockPanels = (edge: DockEdge) => layout.docks[edge].order
    .filter(id => panelById.has(id) && layout.panels[id]?.visible && layout.panels[id].placement === edge);
  const activeByDock = Object.fromEntries(EDGES.map(edge => {
    const ids = dockPanels(edge);
    return [edge, ids.includes(layout.docks[edge].activeId ?? "") ? layout.docks[edge].activeId : ids[0]];
  })) as Record<DockEdge, string | undefined>;
  const shown = new Set<string>();

  const dock = (edge: DockEdge) => {
    const ids = dockPanels(edge);
    const activeId = activeByDock[edge];
    if (!ids.length || layout.focusViewport) return null;
    const active = activeId ? panelById.get(activeId) : undefined;
    if (active) shown.add(active.id);
    return <aside className={`dock-workspace__dock dock-workspace__dock--${edge}`} aria-label={`${edge} dock`}>
      <div className="dock-workspace__tabs" role="tablist" aria-label={`${edge} panels`}>
        {ids.map(id => { const panel = panelById.get(id)!; return <button key={id} type="button" role="tab"
          aria-selected={id === activeId} onClick={() => emit(activateWorkspacePanel(layoutRef.current, id))}
          onPointerDown={event => beginMove(event, id)} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={cancelInteraction}>
          {panel.title}
        </button>; })}
      </div>
      {active && panelShell(active, false)}
    </aside>;
  };

  const floats = !effectiveCompact && !layout.focusViewport ? panels.filter(panel => {
    const state = layout.panels[panel.id];
    return state?.visible && state.placement === "float";
  }) : [];
  floats.forEach(panel => shown.add(panel.id));
  if (effectiveCompact && !layout.focusViewport && compactActiveId && layout.panels[compactActiveId]?.visible) shown.add(compactActiveId);

  const leftOpen = !effectiveCompact && !layout.focusViewport && dockPanels("left").length > 0;
  const rightOpen = !effectiveCompact && !layout.focusViewport && dockPanels("right").length > 0;
  const bottomOpen = !effectiveCompact && !layout.focusViewport && dockPanels("bottom").length > 0;
  const gridStyle = {
    gridTemplateColumns: `${leftOpen ? Math.min(layout.docks.left.size, dockSizeLimit("left", bounds)) : 0}px ${leftOpen ? 6 : 0}px minmax(0,1fr) ${rightOpen ? 6 : 0}px ${rightOpen ? Math.min(layout.docks.right.size, dockSizeLimit("right", bounds)) : 0}px`,
    gridTemplateRows: `minmax(120px,1fr) ${bottomOpen ? 6 : 0}px ${bottomOpen ? Math.min(layout.docks.bottom.size, dockSizeLimit("bottom", bounds)) : 0}px`,
  };

  const choosePanel = (id: string) => {
    setManagerValue("");
    if (!id) return;
    let next = layoutRef.current;
    if (!next.panels[id]?.visible) next = setWorkspacePanelVisible(next, id, true);
    if (next.focusViewport) next = { ...next, focusViewport: false };
    next = activateWorkspacePanel(next, id);
    emit(next);
    if (effectiveCompact) setCompactActiveId(id);
    requestAnimationFrame(() => headerRefs.current.get(id)?.focus({ preventScroll: true }));
  };

  return <div className={`dock-workspace ${effectiveCompact ? "dock-workspace--compact" : ""}`} ref={rootRef}
    onKeyDown={event => {
      if (!event.defaultPrevented && event.key === "Escape" && effectiveCompact && compactActiveId) {
        event.preventDefault(); event.stopPropagation(); dismissDrawer();
      }
    }}>
    <nav className="dock-workspace__toolbar" aria-label="Workspace panels">
      <label><span>Panel</span><select ref={managerRef} aria-label="Open or focus panel" value={managerValue}
        onChange={event => { setManagerValue(event.target.value); choosePanel(event.target.value); }}>
        <option value="">Choose…</option>{panels.map(panel => <option key={panel.id} value={panel.id}>
          {layout.panels[panel.id]?.visible ? panel.title : `Reopen ${panel.title}`}
        </option>)}
      </select></label>
      <button type="button" aria-pressed={layout.focusViewport} onClick={() => emit({ ...layoutRef.current, focusViewport: !layoutRef.current.focusViewport })}>
        {layout.focusViewport ? "Show panels" : "Focus viewport"}
      </button>
      <button type="button" onClick={() => emit(createWorkspaceLayout(panels))}>Reset layout</button>
    </nav>
    <div className="dock-workspace__stage" ref={stageRef} style={effectiveCompact ? undefined : gridStyle}>
      <main className="dock-workspace__center" aria-label="Workspace viewport">{children}</main>
      {!effectiveCompact && <>
        {dock("left")}{dock("right")}{dock("bottom")}
        {leftOpen && <div className="dock-workspace__splitter dock-workspace__splitter--left" role="separator" tabIndex={0} aria-label="Resize left dock"
          aria-orientation="vertical" onKeyDown={event => resizeDockByKeyboard(event, "left")}
          onPointerDown={event => beginSplit(event, "left")} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={cancelInteraction} />}
        {rightOpen && <div className="dock-workspace__splitter dock-workspace__splitter--right" role="separator" tabIndex={0} aria-label="Resize right dock"
          aria-orientation="vertical" onKeyDown={event => resizeDockByKeyboard(event, "right")}
          onPointerDown={event => beginSplit(event, "right")} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={cancelInteraction} />}
        {bottomOpen && <div className="dock-workspace__splitter dock-workspace__splitter--bottom" role="separator" tabIndex={0} aria-label="Resize bottom dock"
          aria-orientation="horizontal" onKeyDown={event => resizeDockByKeyboard(event, "bottom")}
          onPointerDown={event => beginSplit(event, "bottom")} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={cancelInteraction} />}
        {floats.map(panel => {
          const state = layout.panels[panel.id];
          const rect = state.maximized ? { x: 0, y: 0, width: bounds.width, height: bounds.height } : clampFloatRect(state.float, bounds);
          return <div key={panel.id} className="dock-workspace__float" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: state.z }}>
            {panelShell(panel, true)}
          </div>;
        })}
        {dropPreview && <div className={`dock-workspace__drop-preview dock-workspace__drop-preview--${dropPreview}`} aria-hidden="true">Dock {dropPreview}</div>}
      </>}
      {effectiveCompact && <>
        {compactActiveId && layout.panels[compactActiveId]?.visible && panelById.has(compactActiveId) && !layout.focusViewport && <aside className="dock-workspace__drawer" aria-label={`${panelById.get(compactActiveId)!.title} drawer`}>
          {panelShell(panelById.get(compactActiveId)!, false)}
          <button type="button" className="dock-workspace__drawer-dismiss" onClick={dismissDrawer}>Close drawer</button>
        </aside>}
        <nav className="dock-workspace__launcher" aria-label="Panel launcher">
          {panels.filter(panel => layout.panels[panel.id]?.visible).map(panel => <button key={panel.id} type="button"
            ref={node => { if (node) launcherRefs.current.set(panel.id, node); else launcherRefs.current.delete(panel.id); }}
            aria-pressed={compactActiveId === panel.id} onClick={() => {
              if (compactActiveId === panel.id) dismissDrawer();
              else {
                if (layoutRef.current.focusViewport) emit({ ...layoutRef.current, focusViewport: false });
                setCompactActiveId(panel.id);
                requestAnimationFrame(() => headerRefs.current.get(panel.id)?.focus({ preventScroll: true }));
              }
            }}>
            {panel.title}
          </button>)}
        </nav>
      </>}
      <div className="dock-workspace__parking" hidden aria-hidden="true">
        {panels.filter(panel => !shown.has(panel.id)).map(panel => <div key={panel.id}>{mountContent(panel)}</div>)}
      </div>
    </div>
    {typeof document !== "undefined" && panels.map(panel => {
      const host = hostsRef.current.get(panel.id);
      return host ? createPortal(panel.content, host, panel.id) : null;
    })}
  </div>;
}
