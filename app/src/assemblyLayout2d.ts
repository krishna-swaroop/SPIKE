// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard, Point } from "./boardParser";
import type { VirtualBoardVisual, VirtualHarnessVisual } from "./harnessVisualization";

export type AssemblyViewBox = { x: number; y: number; width: number; height: number };
/** Preferences from older/mismatched packages must not blank a board's layout. */
export function resolveAssemblyLayerFocus(board: Pick<ParsedBoard, "layers"> | null, preferred: unknown): string {
  return typeof preferred === "string" && ["All", "Overview", ...(board?.layers ?? [])].includes(preferred) ? preferred : "All";
}
export type AssemblyDisplayOffset = readonly [number, number];
export type AssemblyLayoutSourceFrame = {
  sourceViewBox: AssemblyViewBox;
  /** Maps parser/native board coordinates into the retained SVG page. */
  boardToSourceOffset: AssemblyDisplayOffset;
  /** Maps the retained SVG page back into parser/native board coordinates. */
  sourceToBoardOffset: AssemblyDisplayOffset;
};
export type AssemblyDisplayPlacement = {
  visual: VirtualBoardVisual;
  /** Display-only translation. The occurrence's physical transform is never changed. */
  offset: AssemblyDisplayOffset;
  bounds: AssemblyViewBox;
};

export function projectAssemblyPoint(transform: readonly number[], point: readonly [number, number, number?]): [number, number, number] {
  const [x, y, z = 0] = point;
  return [transform[0] * x + transform[1] * y + transform[2] * z + transform[3], transform[4] * x + transform[5] * y + transform[6] * z + transform[7], transform[8] * x + transform[9] * y + transform[10] * z + transform[11]];
}

/** SVG's six-value matrix uses the first two rows of the row-major assembly transform. */
export function assemblySvgMatrix(transform: readonly number[]): string {
  return `matrix(${transform[0]} ${transform[4]} ${transform[1]} ${transform[5]} ${transform[3]} ${transform[7]})`;
}

export function assemblyDisplaySvgMatrix(transform: readonly number[], offset: AssemblyDisplayOffset): string {
  return `matrix(${transform[0]} ${transform[4]} ${transform[1]} ${transform[5]} ${transform[3] + offset[0]} ${transform[7] + offset[1]})`;
}

export function assemblyBoardBounds(visual: VirtualBoardVisual, board: ParsedBoard): AssemblyViewBox {
  const source = board.bounds;
  const projected = ([[source.minX, source.minY], [source.maxX, source.minY], [source.maxX, source.maxY], [source.minX, source.maxY]] as Point[]).map(point => projectAssemblyPoint(visual.transform, point));
  let x = Infinity, y = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of projected) { x = Math.min(x, point[0]); y = Math.min(y, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]); }
  return { x, y, width: maxX - x, height: maxY - y };
}

/**
 * KiCad SVG plots use a page-local viewBox while parsed features retain their
 * native CAD coordinates. Keep both translations explicit so source artwork,
 * hit geometry and occurrence transforms never silently mix those frames.
 */
export function assemblyLayoutSourceFrame(board: ParsedBoard, measuredBoardToSourceOffset?: AssemblyDisplayOffset): AssemblyLayoutSourceFrame {
  const boardWidth = board.bounds.maxX - board.bounds.minX;
  const boardHeight = board.bounds.maxY - board.bounds.minY;
  const candidate = board.layoutViewBox;
  const source = candidate && candidate.length === 4 && candidate.every(Number.isFinite)
    && candidate[2] > 0 && candidate[3] > 0
    ? candidate
    : [0, 0, boardWidth, boardHeight] as const;
  const sourceViewBox = { x: source[0], y: source[1], width: source[2], height: source[3] };
  const boardToSourceOffset: AssemblyDisplayOffset = measuredBoardToSourceOffset ?? [
    sourceViewBox.x + (sourceViewBox.width - boardWidth) / 2 - board.bounds.minX,
    sourceViewBox.y + (sourceViewBox.height - boardHeight) / 2 - board.bounds.minY,
  ];
  return {
    sourceViewBox,
    boardToSourceOffset,
    sourceToBoardOffset: [-boardToSourceOffset[0], -boardToSourceOffset[1]],
  };
}

const coordinatePattern = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";

/** Recover KiCad's plot-page translation from retained Edge.Cuts geometry. */
export function inferAssemblyLayoutBoardToSourceOffset(board: ParsedBoard, svgSource: string): AssemblyDisplayOffset | null {
  if (svgSource.length > 20_000_000) return null;
  const rawPoints = [...board.drawings.filter(item => item.layer === "Edge.Cuts").flatMap(item => item.points), ...board.outlineLoops.flat()];
  const unique = (points: readonly Point[]) => [...new Map(points.filter(point => point.length >= 2 && point.every(Number.isFinite))
    .map(point => [`${point[0].toFixed(5)}:${point[1].toFixed(5)}`, point] as const)).values()].slice(0, 512);
  const boardPoints = unique(rawPoints);
  if (boardPoints.length < 2) return null;
  const svgPoints: Point[] = [];
  const pathPattern = new RegExp(`(?:^|[\\s\"])(?:M|L)\\s*(${coordinatePattern})[\\s,]+(${coordinatePattern})`, "gi");
  for (const match of svgSource.matchAll(pathPattern)) svgPoints.push([Number(match[1]), Number(match[2])]);
  const sourcePoints = unique(svgPoints);
  if (sourcePoints.length < 2) return null;
  const candidates = new Map<string, { offset: AssemblyDisplayOffset; count: number }>();
  for (const boardPoint of boardPoints) for (const sourcePoint of sourcePoints) {
    const offset: AssemblyDisplayOffset = [sourcePoint[0] - boardPoint[0], sourcePoint[1] - boardPoint[1]];
    const key = `${offset[0].toFixed(3)}:${offset[1].toFixed(3)}`;
    const candidate = candidates.get(key);
    if (candidate) candidate.count += 1;
    else candidates.set(key, { offset, count: 1 });
  }
  let best: { offset: AssemblyDisplayOffset; count: number } | undefined;
  for (const candidate of candidates.values()) if (!best || candidate.count > best.count) best = candidate;
  if (!best || best.count < 2) return null;
  const tolerance = .03;
  const matches = boardPoints.filter(point => sourcePoints.some(source => Math.abs(source[0] - point[0] - best.offset[0]) <= tolerance
    && Math.abs(source[1] - point[1] - best.offset[1]) <= tolerance)).length;
  return matches >= Math.min(3, boardPoints.length) ? best.offset : null;
}

/** Bounds occupied by the retained SVG page after mapping it to native board coordinates. */
export function assemblyLayoutImageBounds(board: ParsedBoard): AssemblyViewBox {
  const frame = assemblyLayoutSourceFrame(board);
  return {
    x: frame.sourceViewBox.x + frame.sourceToBoardOffset[0],
    y: frame.sourceViewBox.y + frame.sourceToBoardOffset[1],
    width: frame.sourceViewBox.width,
    height: frame.sourceViewBox.height,
  };
}

export function assemblyLayerOpacity(layer: string, opacity: Readonly<Record<string, number>>): number {
  const value = opacity[layer] ?? 1;
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export function assemblyLayerIsRendered(layer: string, visibility: Readonly<Record<string, boolean>>, opacity: Readonly<Record<string, number>>): boolean {
  return visibility[layer] !== false && assemblyLayerOpacity(layer, opacity) > 0;
}

function assemblyDisplayBounds(visual: VirtualBoardVisual, board: ParsedBoard, measuredBoardToSourceOffset?: AssemblyDisplayOffset | null): AssemblyViewBox {
  if (!Object.keys(board.layoutLayerUrls ?? {}).length || measuredBoardToSourceOffset === null) return assemblyBoardBounds(visual, board);
  const frame = assemblyLayoutSourceFrame(board, measuredBoardToSourceOffset ?? undefined);
  const page = { x: frame.sourceViewBox.x + frame.sourceToBoardOffset[0], y: frame.sourceViewBox.y + frame.sourceToBoardOffset[1], width: frame.sourceViewBox.width, height: frame.sourceViewBox.height };
  const minX = Math.min(board.bounds.minX, page.x), minY = Math.min(board.bounds.minY, page.y);
  const maxX = Math.max(board.bounds.maxX, page.x + page.width), maxY = Math.max(board.bounds.maxY, page.y + page.height);
  return assemblyBoardBounds(visual, { ...board, bounds: { minX, minY, maxX, maxY } });
}

/**
 * Produces a compact, deterministic shelf layout from conservative transformed
 * board bounds. Only display translations are returned; solver/3D transforms
 * and source geometry remain authoritative and untouched.
 */
export function arrangeAssemblyBoards(
  visuals: readonly VirtualBoardVisual[],
  designs: Readonly<Record<string, ParsedBoard>>,
  minimumGapMm = 5,
  measuredBoardToSourceByDesign?: Readonly<Record<string, AssemblyDisplayOffset | null>>,
): AssemblyDisplayPlacement[] {
  const measured = visuals
    .map(visual => {
      const board = designs[visual.designId];
      return board ? { visual, source: assemblyDisplayBounds(visual, board, measuredBoardToSourceByDesign ? measuredBoardToSourceByDesign[visual.designId] ?? null : undefined) } : null;
    })
    .filter((item): item is { visual: VirtualBoardVisual; source: AssemblyViewBox } => item !== null)
    .sort((a, b) => a.visual.id.localeCompare(b.visual.id));
  if (!measured.length) return [];
  let maxDimension = 0;
  for (const item of measured) maxDimension = Math.max(maxDimension, item.source.width, item.source.height);
  const gap = Math.max(minimumGapMm, maxDimension * .05);
  const totalArea = measured.reduce((sum, item) => sum + (item.source.width + gap) * (item.source.height + gap), 0);
  const targetWidth = Math.max(maxDimension + gap, Math.sqrt(totalArea) * 1.35);
  const placements: AssemblyDisplayPlacement[] = [];
  let cursorX = 0, cursorY = 0, rowHeight = 0;
  for (const item of measured) {
    if (cursorX > 0 && cursorX + item.source.width > targetWidth) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    const bounds = { x: cursorX, y: cursorY, width: item.source.width, height: item.source.height };
    placements.push({ visual: item.visual, offset: [bounds.x - item.source.x, bounds.y - item.source.y], bounds });
    cursorX += item.source.width + gap;
    rowHeight = Math.max(rowHeight, item.source.height);
  }
  return placements;
}

export function displayOffsetByBoard(placements: readonly AssemblyDisplayPlacement[]): Readonly<Record<string, AssemblyDisplayOffset>> {
  return Object.fromEntries(placements.map(item => [item.visual.id, item.offset]));
}

export function offsetAssemblyPoint(point: readonly [number, number, number?], offset: AssemblyDisplayOffset | undefined): [number, number, number] {
  return [point[0] + (offset?.[0] ?? 0), point[1] + (offset?.[1] ?? 0), point[2] ?? 0];
}

export function harnessAssemblyPoints(harness: VirtualHarnessVisual): readonly (readonly [number, number, number])[] {
  return harness.routeMm.length >= 2 ? harness.routeMm : [harness.endpointA.positionMm, harness.endpointB.positionMm];
}

/** Relocates a displayed route while keeping its physical route data unchanged. */
export function harnessDisplayPoints(harness: VirtualHarnessVisual, offsets: Readonly<Record<string, AssemblyDisplayOffset>>): readonly (readonly [number, number, number])[] {
  const points = harnessAssemblyPoints(harness);
  const a = offsets[harness.endpointA.boardId] ?? [0, 0];
  const b = offsets[harness.endpointB.boardId] ?? [0, 0];
  if (points.length === 1) return [offsetAssemblyPoint(points[0], a)];
  return points.map((point, index) => {
    const t = index / (points.length - 1);
    return [point[0] + a[0] * (1 - t) + b[0] * t, point[1] + a[1] * (1 - t) + b[1] * t, point[2]] as const;
  });
}

export function displayContentBounds(placements: readonly AssemblyDisplayPlacement[], harnesses: readonly VirtualHarnessVisual[] = []): AssemblyViewBox {
  const offsets = displayOffsetByBoard(placements);
  const points: Point[] = placements.flatMap(item => [[item.bounds.x, item.bounds.y], [item.bounds.x + item.bounds.width, item.bounds.y + item.bounds.height]] as Point[]);
  for (const harness of harnesses) for (const point of harnessDisplayPoints(harness, offsets)) points.push([point[0], point[1]]);
  if (!points.length) return { x: -5, y: -5, width: 10, height: 10 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]); }
  const margin = Math.max(2, Math.max(maxX - minX, maxY - minY) * .06);
  return { x: minX - margin, y: minY - margin, width: Math.max(maxX - minX + margin * 2, 1), height: Math.max(maxY - minY + margin * 2, 1) };
}

export function assemblyContentBounds(visuals: readonly VirtualBoardVisual[], designs: Readonly<Record<string, ParsedBoard>>, harnesses: readonly VirtualHarnessVisual[] = []): AssemblyViewBox {
  const points: Point[] = [];
  for (const visual of visuals) {
    const board = designs[visual.designId];
    if (!board) continue;
    const bounds = assemblyBoardBounds(visual, board);
    points.push([bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height]);
  }
  for (const harness of harnesses) for (const point of harnessAssemblyPoints(harness)) points.push([point[0], point[1]]);
  if (!points.length) return { x: -5, y: -5, width: 10, height: 10 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]); }
  const margin = Math.max(2, Math.max(maxX - minX, maxY - minY) * 0.06);
  return { x: minX - margin, y: minY - margin, width: Math.max(maxX - minX + margin * 2, 1), height: Math.max(maxY - minY + margin * 2, 1) };
}

export function boardAssemblyZ(visual: VirtualBoardVisual): number {
  return projectAssemblyPoint(visual.transform, visual.localCenterMm)[2];
}

/** Parsed objects carry names; assembly selection carries stable canonical IDs. */
export function canonicalNetId(board: ParsedBoard, nameToId: Readonly<Record<string, string>> | undefined, parsedNetName: string | undefined): string | null {
  if (!parsedNetName) return null;
  if (nameToId?.[board.nets[parsedNetName] ?? parsedNetName]) return nameToId[board.nets[parsedNetName] ?? parsedNetName];
  return Object.entries(board.nets).find(([, name]) => name === parsedNetName)?.[0] ?? parsedNetName;
}

export function assemblyNetIsSelected(board: ParsedBoard, nameToId: Readonly<Record<string, string>> | undefined, linkedCanonicalIds: readonly string[], parsedNetName: string | undefined): boolean {
  const id = canonicalNetId(board, nameToId, parsedNetName);
  return Boolean(id && linkedCanonicalIds.includes(id));
}
