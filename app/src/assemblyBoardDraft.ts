// SPDX-License-Identifier: Apache-2.0
import { placementFromTransform, transformFromPlacement, type AssemblyPlacement } from "./mcadAssembly";

export const BOARD_INSTANCE_STARTER_GAP_MM = 30;

export type BoardDraftEnvelope = { minX: number; minY: number; maxX: number; maxY: number };
export type BoardDraftOccurrence = { transform: number[]; envelope: BoardDraftEnvelope | null };

const finiteBounds = (values: unknown[]): values is number[] => values.length === 4 && values.every(value => typeof value === "number" && Number.isFinite(value));

export function retainedDesignBoardEnvelope(design: Record<string, unknown> | undefined): BoardDraftEnvelope | null {
  const metadata = design?.metadata && typeof design.metadata === "object" && !Array.isArray(design.metadata)
    ? design.metadata as Record<string, unknown> : {};
  const bounds = metadata.board_bounds_mm;
  if (Array.isArray(bounds) && finiteBounds(bounds) && bounds[2] > bounds[0] && bounds[3] > bounds[1]) {
    return { minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3] };
  }
  const size = metadata.board_size_mm;
  if (Array.isArray(size) && size.length === 2 && size.every(value => typeof value === "number" && Number.isFinite(value) && value > 0)) {
    return { minX: 0, minY: 0, maxX: size[0] as number, maxY: size[1] as number };
  }
  const legacy = metadata.board_bbox;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    const item = legacy as Record<string, unknown>;
    const values = [item.min_x, item.min_y, item.max_x, item.max_y];
    if (finiteBounds(values) && values[2] > values[0] && values[3] > values[1]) {
      return { minX: values[0], minY: values[1], maxX: values[2], maxY: values[3] };
    }
  }
  return null;
}

function projectedBounds(transform: number[], envelope: BoardDraftEnvelope | null) {
  const bounds = envelope ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const points = [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]];
  const projected = points.map(([x, y]) => [transform[0] * x + transform[1] * y + transform[3], transform[4] * x + transform[5] * y + transform[7]]);
  let minX = projected[0][0], maxX = projected[0][0], minY = projected[0][1], maxY = projected[0][1];
  for (let index = 1; index < projected.length; index++) {
    minX = Math.min(minX, projected[index][0]); maxX = Math.max(maxX, projected[index][0]);
    minY = Math.min(minY, projected[index][1]); maxY = Math.max(maxY, projected[index][1]);
  }
  return {
    minX, maxX, minY, maxY,
  };
}

/** Place a new occurrence to the right of its source and all intersecting board envelopes. */
export function separatedBoardPlacement(occupied: BoardDraftOccurrence[], source?: BoardDraftOccurrence, gapMm = BOARD_INSTANCE_STARTER_GAP_MM): AssemblyPlacement {
  const fallback = occupied[occupied.length - 1];
  const sourceOccurrence = source ?? fallback;
  const sourcePlacement = sourceOccurrence ? placementFromTransform(sourceOccurrence.transform) : {
    xMm: -gapMm, yMm: 0, zMm: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0,
  };
  const sourceBounds = sourceOccurrence ? projectedBounds(sourceOccurrence.transform, sourceOccurrence.envelope) : { minX: -gapMm, maxX: -gapMm, minY: 0, maxY: 0 };
  const next = { ...sourcePlacement, xMm: sourcePlacement.xMm + (sourceBounds.maxX - sourceBounds.minX) + gapMm };
  for (let attempt = 0; attempt <= occupied.length; attempt++) {
    const transform = transformFromPlacement(next);
    const candidate = projectedBounds(transform, sourceOccurrence?.envelope ?? null);
    const collision = occupied.map(item => projectedBounds(item.transform, item.envelope)).find(item =>
      candidate.maxX + gapMm > item.minX && candidate.minX - gapMm < item.maxX
      && candidate.maxY + gapMm > item.minY && candidate.minY - gapMm < item.maxY);
    if (!collision) break;
    next.xMm += collision.maxX + gapMm - candidate.minX;
  }
  return next;
}

export function separatedBoardTransform(occupied: BoardDraftOccurrence[], source?: BoardDraftOccurrence, gapMm = BOARD_INSTANCE_STARTER_GAP_MM) {
  return transformFromPlacement(separatedBoardPlacement(occupied, source, gapMm));
}
