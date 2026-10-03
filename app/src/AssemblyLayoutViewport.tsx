// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { ParsedBoard } from "./boardParser";
import type { VirtualBoardVisual, VirtualHarnessVisual } from "./harnessVisualization";
import { arrangeAssemblyBoards, assemblyLayoutImageBounds, assemblyDisplaySvgMatrix, boardAssemblyZ, canonicalNetId, displayContentBounds, displayOffsetByBoard, harnessDisplayPoints, offsetAssemblyPoint, type AssemblyViewBox } from "./assemblyLayout2d";
import { layerCssColor } from "./layerPalette";
import "./AssemblyLayoutViewport.css";
import type { AssemblySnapTarget } from "./assemblySnapTargets";
import { assemblyPanStarted, focusAssemblyViewBox, panAssemblyViewBox, zoomAssemblyViewBox, type AssemblyViewportRect } from "./assemblyViewportInteraction";

export interface AssemblyLayoutViewportProps {
  designs: Record<string, ParsedBoard>;
  boards: VirtualBoardVisual[];
  harnesses: VirtualHarnessVisual[];
  selectedBoardId: string | null;
  linkedNets: Record<string, string[]>;
  visibleLayers: Record<string, boolean>;
  assemblyLayerVisibility?: Record<string, Record<string, boolean>>;
  assemblyLayerOpacity?: Record<string, Record<string, number>>;
  layerOpacity: Record<string, number>;
  showVias: boolean;
  selectionFilter?: "all" | "part" | "net";
  onBoardSelect: (board: VirtualBoardVisual) => void;
  onShowAllBoards?: () => void;
  onComponentSelect?: (boardId: string, componentId: string) => void;
  onNetSelect: (boardId: string, canonicalNetId: string) => void;
  cameraCommand?: string;
  snapTargets?: AssemblySnapTarget[];
  selectedSnapTargetId?: string | null;
  onSnapTarget?: (target: AssemblySnapTarget) => void;
}

const safeLayerImage = (url: string) => /^(?:blob:|data:image\/svg\+xml(?:;base64)?,|https?:\/\/|asset:|\/demo\/models\/)/i.test(url);
const visible = (layer: string, layers: Record<string, boolean>) => layers[layer] !== false;

type FocusTarget = { boardId: string; bounds: AssemblyViewBox };

function svgGraphicBounds(element: SVGGraphicsElement, svg: SVGSVGElement): AssemblyViewBox | null {
  try {
    const box = element.getBBox();
    const elementMatrix = element.getScreenCTM();
    const svgMatrix = svg.getScreenCTM();
    if (!elementMatrix || !svgMatrix) return null;
    const toSvg = svgMatrix.inverse().multiply(elementMatrix);
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(toSvg));
    let x = Infinity, y = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of corners) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      x = Math.min(x, point.x); y = Math.min(y, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    return { x, y, width: maxX - x, height: maxY - y };
  } catch {
    return null;
  }
}

function NetShape({ board, visual, linked, net, onNetSelect, onFocus, selectable = true, children }: { board: ParsedBoard; visual: VirtualBoardVisual; linked: string[]; net?: string; onNetSelect: AssemblyLayoutViewportProps["onNetSelect"]; onFocus?: (boardId: string, element: SVGGraphicsElement) => void; selectable?: boolean; children: ReactElement }) {
  const id = canonicalNetId(board, visual.netIdsByName, net);
  return <g data-canonical-net-id={id ?? undefined} onClick={id && selectable ? event => { event.stopPropagation(); onFocus?.(visual.id, event.currentTarget); onNetSelect(visual.id, id); } : undefined} style={{ cursor: id && selectable ? "pointer" : undefined, filter: id && linked.includes(id) ? "drop-shadow(0 0 1px #ffe25b)" : undefined }}>{children}</g>;
}

function BoardFallback({ board, visual, linked, visibleLayers, layerOpacity, showVias, onNetSelect, onFocus, netSelectable }: { board: ParsedBoard; visual: VirtualBoardVisual; linked: string[]; onFocus: (boardId: string, element: SVGGraphicsElement) => void; netSelectable: boolean } & Pick<AssemblyLayoutViewportProps, "visibleLayers" | "layerOpacity" | "showVias" | "onNetSelect">) {
  const color = (layer: string) => layerCssColor(layer, Math.max(0, board.layers.indexOf(layer)));
  const opacity = (layer: string) => Math.max(0, Math.min(1, layerOpacity[layer] ?? 1));
  return <>
    {board.zones.filter(item => visible(item.layer, visibleLayers)).map((item, i) => <NetShape key={`z:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus} selectable={netSelectable}><path d={[item.points, ...(item.holes ?? [])].map(loop => `M ${loop.map(p => `${p[0]} ${p[1]}`).join(" L ")} Z`).join(" ")} fill={color(item.layer)} fillOpacity={opacity(item.layer) * .38} fillRule="evenodd" /></NetShape>)}
    {board.drawings.filter(item => visible(item.layer, visibleLayers)).map((item, i) => item.points.length > 1 && (item.filled ? <polygon key={`d:${item.id}:${i}`} points={item.points.map(p => p.join(",")).join(" ")} fill={color(item.layer)} opacity={opacity(item.layer)} /> : <polyline key={`d:${item.id}:${i}`} points={item.points.map(p => p.join(",")).join(" ")} fill="none" stroke={color(item.layer)} strokeWidth={Math.max(item.width, .08)} opacity={opacity(item.layer)} />))}
    {board.tracks.filter(item => visible(item.layer, visibleLayers)).map((item, i) => <NetShape key={`t:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus} selectable={netSelectable}><line x1={item.start[0]} y1={item.start[1]} x2={item.end[0]} y2={item.end[1]} stroke={color(item.layer)} strokeWidth={item.width} strokeLinecap="round" opacity={opacity(item.layer)} /></NetShape>)}
    {showVias && board.vias.filter(item => item.layers.some(layer => visible(layer, visibleLayers))).map((item, i) => <NetShape key={`v:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus} selectable={netSelectable}><circle cx={item.at[0]} cy={item.at[1]} r={item.size / 2} fill="#d9b45c" stroke="#fff1b8" strokeWidth={.08} /></NetShape>)}
    {board.pads.filter(item => item.layers.some(layer => visible(layer, visibleLayers))).map((item, i) => <NetShape key={`p:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus} selectable={netSelectable}><rect x={item.at[0] - item.width / 2} y={item.at[1] - item.height / 2} width={item.width} height={item.height} rx={Math.min(item.width, item.height) * .16} fill="#d8a944" transform={`rotate(${item.rotation} ${item.at[0]} ${item.at[1]})`} /></NetShape>)}
  </>;
}

function ComponentShapes({ board, visual, sourceLayers, onBoardSelect, onComponentSelect, onFocus }: { board: ParsedBoard; visual: VirtualBoardVisual; sourceLayers: boolean; onFocus: (boardId: string, element: SVGGraphicsElement) => void } & Pick<AssemblyLayoutViewportProps, "onBoardSelect" | "onComponentSelect">) {
  return <>{board.components.map((item, i) => <g
    key={`c:${item.id}:${i}`}
    data-component-id={item.id}
    transform={`translate(${item.at[0]} ${item.at[1]}) rotate(${item.rotation})`}
    onClick={event => {
      event.stopPropagation();
      onFocus(visual.id, event.currentTarget);
      onBoardSelect(visual);
      onComponentSelect?.(visual.id, item.id);
    }}
    style={{ cursor: onComponentSelect ? "pointer" : undefined }}
  >
    <rect x={-item.width / 2} y={-item.height / 2} width={item.width} height={item.height} fill={sourceLayers ? "transparent" : "none"} stroke={sourceLayers ? "transparent" : "#e6e9ef"} strokeWidth={sourceLayers ? 0 : .12} pointerEvents="all"><title>{item.ref}</title></rect>
    {!sourceLayers && <text fontSize={Math.max(.8, Math.min(item.width / 4, 1.8))} textAnchor="middle" dominantBaseline="central" fill="#f4f5f7" pointerEvents="none">{item.ref}</text>}
  </g>)}</>;
}

function NetHitShapes({ board, visual, linked, visibleLayers, showVias, onNetSelect, onFocus }: { board: ParsedBoard; visual: VirtualBoardVisual; linked: string[]; onFocus: (boardId: string, element: SVGGraphicsElement) => void } & Pick<AssemblyLayoutViewportProps, "visibleLayers" | "showVias" | "onNetSelect">) {
  const selected = (net?: string) => { const id = canonicalNetId(board, visual.netIdsByName, net); return Boolean(id && linked.includes(id)); };
  return <g className="assembly-layout-net-hits">
    {board.zones.filter(item => visible(item.layer, visibleLayers)).map((item, i) => <NetShape key={`zh:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus}><path d={[item.points, ...(item.holes ?? [])].map(loop => `M ${loop.map(point => `${point[0]} ${point[1]}`).join(" L ")} Z`).join(" ")} fill={selected(item.net) ? "#ffe25b" : "transparent"} fillOpacity={selected(item.net) ? .16 : 0} fillRule="evenodd" pointerEvents="fill" /></NetShape>)}
    {board.tracks.filter(item => visible(item.layer, visibleLayers)).map((item, i) => <NetShape key={`th:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus}><line x1={item.start[0]} y1={item.start[1]} x2={item.end[0]} y2={item.end[1]} stroke={selected(item.net) ? "#ffe25b" : "transparent"} strokeWidth={Math.max(item.width, .8)} strokeLinecap="round" pointerEvents="stroke" /></NetShape>)}
    {showVias && board.vias.filter(item => item.layers.some(layer => visible(layer, visibleLayers))).map((item, i) => <NetShape key={`vh:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus}><circle cx={item.at[0]} cy={item.at[1]} r={Math.max(item.size / 2, .5)} fill={selected(item.net) ? "#ffe25b" : "transparent"} fillOpacity={selected(item.net) ? .7 : 0} pointerEvents="all" /></NetShape>)}
    {board.pads.filter(item => item.layers.some(layer => visible(layer, visibleLayers))).map((item, i) => <NetShape key={`ph:${item.id}:${i}`} board={board} visual={visual} linked={linked} net={item.net} onNetSelect={onNetSelect} onFocus={onFocus}><rect x={item.at[0] - item.width / 2} y={item.at[1] - item.height / 2} width={item.width} height={item.height} rx={Math.min(item.width, item.height) * .16} fill={selected(item.net) ? "#ffe25b" : "transparent"} fillOpacity={selected(item.net) ? .7 : 0} transform={`rotate(${item.rotation} ${item.at[0]} ${item.at[1]})`} pointerEvents="all" /></NetShape>)}
  </g>;
}

export default function AssemblyLayoutViewport({ designs, boards, harnesses, selectedBoardId, linkedNets, visibleLayers, assemblyLayerVisibility = {}, assemblyLayerOpacity = {}, layerOpacity, showVias, selectionFilter = "all", onBoardSelect, onShowAllBoards, onComponentSelect, onNetSelect, cameraCommand = "", snapTargets = [], selectedSnapTargetId = null, onSnapTarget }: AssemblyLayoutViewportProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; view: AssemblyViewBox; panning: boolean } | null>(null);
  const suppressClick = useRef(false);
  const handledCameraCommand = useRef("");
  const lastFocus = useRef<FocusTarget | null>(null);
  const placements = useMemo(() => arrangeAssemblyBoards(boards, designs), [boards, designs]);
  const offsets = useMemo(() => displayOffsetByBoard(placements), [placements]);
  const placementById = useMemo(() => Object.fromEntries(placements.map(item => [item.visual.id, item])), [placements]);
  const fit = useMemo(() => displayContentBounds(placements, harnesses), [placements, harnesses]);
  const [view, setView] = useState(fit);
  const viewportRect = (): AssemblyViewportRect => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0, width: Math.max(rect?.width ?? 1, 1), height: Math.max(rect?.height ?? 1, 1) };
  };
  const frame = (bounds: AssemblyViewBox, margin = .12) => {
    const rect = viewportRect();
    return focusAssemblyViewBox(bounds, rect.width / rect.height, margin);
  };
  const focusSelection = () => {
    const remembered = lastFocus.current?.boardId === selectedBoardId ? lastFocus.current.bounds : null;
    const boardBounds = selectedBoardId ? placementById[selectedBoardId]?.bounds : null;
    if (remembered ?? boardBounds) setView(frame((remembered ?? boardBounds)!));
  };
  const rememberGraphic = (boardId: string, element: SVGGraphicsElement) => {
    const bounds = svgRef.current ? svgGraphicBounds(element, svgRef.current) : null;
    if (bounds) lastFocus.current = { boardId, bounds };
  };
  useEffect(() => setView(frame(fit, .03)), [fit.x, fit.y, fit.width, fit.height]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const factor = event.deltaY < 0 ? .82 : 1.22;
      setView(current => zoomAssemblyViewBox(current, rect, event.clientX, event.clientY, factor));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    if (!cameraCommand || handledCameraCommand.current === cameraCommand) return;
    handledCameraCommand.current = cameraCommand;
    if (cameraCommand.startsWith("fit")) { setView(frame(fit, .03)); return; }
    if (cameraCommand.startsWith("focus-selection")) { focusSelection(); return; }
    setView(current => {
      if (cameraCommand.startsWith("zoom-")) { const factor = cameraCommand.startsWith("zoom-in") ? .8 : 1.25; return { x: current.x + current.width * (1 - factor) / 2, y: current.y + current.height * (1 - factor) / 2, width: current.width * factor, height: current.height * factor }; }
      const dx = current.width * .08, dy = current.height * .08;
      return { ...current, x: current.x + (cameraCommand.startsWith("pan-left") ? -dx : cameraCommand.startsWith("pan-right") ? dx : 0), y: current.y + (cameraCommand.startsWith("pan-up") ? -dy : cameraCommand.startsWith("pan-down") ? dy : 0) };
    });
  }, [cameraCommand, fit]);
  const sorted = useMemo(() => [...boards].sort((a, b) => boardAssemblyZ(a) - boardAssemblyZ(b)), [boards]);
  const selected = sorted.find(board => board.id === selectedBoardId);
  const drawOrder = selected ? [...sorted.filter(board => board.id !== selected.id), selected] : sorted;
  return <div className="assembly-layout-viewport" >
    <div className="assembly-layout-controls" role="toolbar" aria-label="Assembly layout controls"><select aria-label="Visible assembly board" value={selectedBoardId ?? ""} onChange={event => { if (!event.target.value) { lastFocus.current = null; onShowAllBoards?.(); setView(frame(fit, .03)); return; } const board = boards.find(item => item.id === event.target.value); if (board) { const bounds = placementById[board.id]?.bounds; lastFocus.current = bounds ? { boardId: board.id, bounds } : null; onBoardSelect(board); } }}><option value="">All boards</option>{boards.map(board => <option key={board.id} value={board.id}>{board.name} (Z {boardAssemblyZ(board).toFixed(2)} mm)</option>)}</select><button type="button" onClick={() => setView(frame(fit, .03))}>Fit</button><button type="button" disabled={!selectedBoardId} onClick={focusSelection}>Focus</button></div>
    <svg ref={svgRef} className="assembly-layout-drawing" aria-label="2D multi-board assembly" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} width="100%" height="100%" onClickCapture={event => { if (!suppressClick.current) return; suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }} onDoubleClick={event => { event.preventDefault(); setView(frame(fit, .03)); }} onPointerDown={event => { if (event.button === 0 && event.isPrimary) drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view, panning: false }; }} onPointerMove={event => { const current = drag.current; if (!current || current.pointerId !== event.pointerId) return; const dx = event.clientX - current.x, dy = event.clientY - current.y; if (!current.panning) { if (!assemblyPanStarted(dx, dy)) return; current.panning = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.style.cursor = "grabbing"; } event.preventDefault(); setView(panAssemblyViewBox(current.view, event.currentTarget.getBoundingClientRect(), dx, dy)); }} onPointerUp={event => { const current = drag.current; if (current?.pointerId !== event.pointerId) return; if (current.panning) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); } drag.current = null; event.currentTarget.style.cursor = ""; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={event => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; suppressClick.current = false; event.currentTarget.style.cursor = ""; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerLeave={() => { if (drag.current && !drag.current.panning) drag.current = null; }} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; event.currentTarget.style.cursor = ""; }}>
      {drawOrder.map(visual => { const board = designs[visual.designId]; const boardLayers = assemblyLayerVisibility[visual.id] ?? visibleLayers; const boardOpacity = assemblyLayerOpacity[visual.id] ?? layerOpacity; const placement = placementById[visual.id]; if (!board || !placement) return null; const isSelected = visual.id === selectedBoardId; const layers = Object.entries(board.layoutLayerUrls ?? {}).filter(([layer, url]) => visible(layer, boardLayers) && safeLayerImage(url)); const box = assemblyLayoutImageBounds(board); return <g key={visual.id} data-board-id={visual.id} transform={assemblyDisplaySvgMatrix(visual.transform, offsets[visual.id] ?? [0, 0])} opacity={selectedBoardId && !isSelected ? .42 : 1} onClick={() => { lastFocus.current = { boardId: visual.id, bounds: placement.bounds }; onBoardSelect(visual); }} style={{ cursor: "pointer" }}>
        <rect x={board.bounds.minX} y={board.bounds.minY} width={board.width} height={board.height} fill="transparent" pointerEvents="all" />
        {layers.length ? layers.map(([layer, url]) => <image key={layer} href={url} x={box.x} y={box.y} width={box.width} height={box.height} opacity={boardOpacity[layer] ?? 1} preserveAspectRatio="none" pointerEvents="none" />) : <BoardFallback board={board} visual={visual} linked={linkedNets[visual.id] ?? []} visibleLayers={boardLayers} layerOpacity={boardOpacity} showVias={showVias} onNetSelect={onNetSelect} onFocus={rememberGraphic} netSelectable={selectionFilter !== "part"} />}
        {layers.length && selectionFilter !== "part" ? <NetHitShapes board={board} visual={visual} linked={linkedNets[visual.id] ?? []} visibleLayers={boardLayers} showVias={showVias} onNetSelect={onNetSelect} onFocus={rememberGraphic} /> : null}
        {selectionFilter !== "net" && <ComponentShapes board={board} visual={visual} sourceLayers={layers.length > 0} onBoardSelect={onBoardSelect} onComponentSelect={onComponentSelect} onFocus={rememberGraphic} />}
        <rect x={board.bounds.minX} y={board.bounds.minY} width={board.width} height={board.height} fill="none" stroke={isSelected ? "#6ee7ff" : "#8295a5"} strokeWidth={isSelected ? .45 : .16} vectorEffect="non-scaling-stroke" pointerEvents="stroke" />
      </g>; })}
      {snapTargets.map(target => { const point = offsetAssemblyPoint(target.worldPointMm, offsets[target.occurrenceId]); return target.kind === "hole"
        ? <circle data-assembly-snap="hole" key={target.id} cx={point[0]} cy={point[1]} r={Math.max(view.width / 250, .6)} fill={target.id === selectedSnapTargetId ? "#ffd32a" : "#6ee7ff"} fillOpacity={.8} onClick={event => { event.stopPropagation(); onSnapTarget?.(target); }} style={{ cursor: "crosshair" }}><title>{target.occurrenceId}: {target.sourceId}</title></circle>
        : <line data-assembly-snap="edge" key={target.id} x1={point[0] - target.worldDirection[0] * target.lengthMm / 2} y1={point[1] - target.worldDirection[1] * target.lengthMm / 2} x2={point[0] + target.worldDirection[0] * target.lengthMm / 2} y2={point[1] + target.worldDirection[1] * target.lengthMm / 2} stroke={target.id === selectedSnapTargetId ? "#ffd32a" : "#6ee7ff"} strokeWidth={Math.max(view.width / 250, .6)} onClick={event => { event.stopPropagation(); onSnapTarget?.(target); }} style={{ cursor: "crosshair" }}><title>{target.occurrenceId}: {target.sourceId}</title></line>; })}
      {harnesses.map(harness => <polyline key={harness.id} data-harness-id={harness.id} points={harnessDisplayPoints(harness, offsets).map(point => `${point[0]},${point[1]}`).join(" ")} fill="none" stroke="#f2b84b" strokeWidth={Math.max(view.width / 700, .25)} strokeDasharray={harness.routedPolyline ? undefined : `${view.width / 120} ${view.width / 180}`} pointerEvents="none" />)}
    </svg>
  </div>;
}
