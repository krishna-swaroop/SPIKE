// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard, Point } from "./boardParser";
import type { VirtualBoardVisual, VirtualHarnessVisual } from "./harnessVisualization";

export type AssemblyViewBox = { x: number; y: number; width: number; height: number };
export type AssemblyDisplayOffset = readonly [number, number];
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

/** KiCad fits plots to a local page; center that page on the source board envelope. */
export function assemblyLayoutImageBounds(board: ParsedBoard): AssemblyViewBox {
  const width = board.layoutViewBox?.[2] ?? board.width;
  const height = board.layoutViewBox?.[3] ?? board.height;
  return { x: board.bounds.minX - (width - board.width) / 2,
    y: board.bounds.minY - (height - board.height) / 2, width, height };
}

function assemblyDisplayBounds(visual: VirtualBoardVisual, board: ParsedBoard): AssemblyViewBox {
  if (!Object.keys(board.layoutLayerUrls ?? {}).length) return assemblyBoardBounds(visual, board);
  const page = assemblyLayoutImageBounds(board);
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
): AssemblyDisplayPlacement[] {
  const measured = visuals
    .map(visual => {
      const board = designs[visual.designId];
      return board ? { visual, source: assemblyDisplayBounds(visual, board) } : null;
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
