// SPDX-License-Identifier: Apache-2.0
import type { VirtualBoardVisual, VirtualHarnessVisual, HarnessPointMm } from "./harnessVisualization";

/** Presentation-only offsets: never feed exploded coordinates to a solver. */
export function assemblyExplodeOffsets(boards: VirtualBoardVisual[], distanceMm: number): Record<string, number> {
  if (!Number.isFinite(distanceMm) || distanceMm < 0) throw new Error("Exploded spacing must be a finite nonnegative distance in mm.");
  const ordered = [...boards].sort((a, b) => a.transform[11] - b.transform[11] || a.id.localeCompare(b.id));
  return Object.fromEntries(ordered.map((board, index) => [board.id, index * distanceMm]));
}

export function assemblyDisplayBoards(boards: VirtualBoardVisual[], visibility: Record<string, boolean>, offsets: Record<string, number>): VirtualBoardVisual[] {
  return boards.filter(board => visibility[board.id] !== false).map(board => {
    const transform = [...board.transform]; transform[11] += offsets[board.id] ?? 0;
    return { ...board, transform };
  });
}

export function assemblyDisplayHarnesses(harnesses: VirtualHarnessVisual[], visibility: Record<string, boolean>, offsets: Record<string, number>): VirtualHarnessVisual[] {
  return harnesses.filter(harness => visibility[harness.endpointA.boardId] !== false && visibility[harness.endpointB.boardId] !== false).map(harness => {
    const a = offsets[harness.endpointA.boardId] ?? 0, b = offsets[harness.endpointB.boardId] ?? 0;
    const shifted = (point: HarnessPointMm, dz: number): HarnessPointMm => [point[0], point[1], point[2] + dz];
    return { ...harness, endpointA: { ...harness.endpointA, positionMm: shifted(harness.endpointA.positionMm, a) }, endpointB: { ...harness.endpointB, positionMm: shifted(harness.endpointB.positionMm, b) },
      routeMm: harness.routeMm.map((point, index, points) => shifted(point, a + (b - a) * (points.length > 1 ? index / (points.length - 1) : .5))) };
  });
}
