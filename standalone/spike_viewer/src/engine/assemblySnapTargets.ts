// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard, ParsedPad, ParsedVia, Point } from "./boardTypes";
import type { VirtualBoardVisual } from "./harnessVisualization";

export type SnapPointMm = readonly [number, number, number];
export type AssemblyHoleSnapTarget = {
  kind: "hole";
  id: string;
  occurrenceId: string;
  sourceId: string;
  sourceKind: "pad" | "via";
  sourcePointMm: SnapPointMm;
  worldPointMm: SnapPointMm;
  sourceNormal: SnapPointMm;
  worldNormal: SnapPointMm;
  drillSizeMm: readonly [number, number];
  plated?: boolean;
};
export type AssemblyEdgeSnapTarget = {
  kind: "edge";
  id: string;
  occurrenceId: string;
  sourceId: string;
  loopIndex: number;
  edgeIndex: number;
  sourcePointMm: SnapPointMm;
  worldPointMm: SnapPointMm;
  sourceDirection: SnapPointMm;
  worldDirection: SnapPointMm;
  sourceOutward: SnapPointMm;
  worldOutward: SnapPointMm;
  sourceNormal: SnapPointMm;
  worldNormal: SnapPointMm;
  lengthMm: number;
};
export type AssemblySnapTarget = AssemblyHoleSnapTarget | AssemblyEdgeSnapTarget;

export type SnapPlacementOptions = {
  /** Clearance in millimetres. Holes separate along the fixed board normal; edges along the fixed edge outward. */
  gapMm?: number;
  /** Retain the moving occurrence angle, or minimally rotate its selected edge onto the fixed edge. */
  edgeAngle?: "retain" | "align";
  /** Aligned mating edges normally run in opposite source directions. */
  edgeDirection?: "parallel" | "antiparallel";
};

const EPSILON = 1e-9;
const point3 = (point: Point): SnapPointMm => [point[0], point[1], 0];
const add = (a: SnapPointMm, b: SnapPointMm): SnapPointMm => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: SnapPointMm, b: SnapPointMm): SnapPointMm => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (value: SnapPointMm, factor: number): SnapPointMm => [value[0] * factor, value[1] * factor, value[2] * factor];
const dot = (a: SnapPointMm, b: SnapPointMm) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: SnapPointMm, b: SnapPointMm): SnapPointMm => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
function normalize(value: SnapPointMm): SnapPointMm {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length <= EPSILON) throw new Error("Snap direction must have non-zero finite length.");
  return scale(value, 1 / length);
}

function assertRigidTransform(value: readonly number[]): void {
  if (value.length !== 16 || !value.every(Number.isFinite)) throw new Error("Snap occurrence transform must contain 16 finite values.");
  const columns = [
    [value[0], value[4], value[8]] as SnapPointMm,
    [value[1], value[5], value[9]] as SnapPointMm,
    [value[2], value[6], value[10]] as SnapPointMm,
  ];
  if (columns.some(column => Math.abs(dot(column, column) - 1) > 1e-6)
    || Math.abs(dot(columns[0], columns[1])) > 1e-6
    || Math.abs(dot(columns[0], columns[2])) > 1e-6
    || Math.abs(dot(columns[1], columns[2])) > 1e-6
    || Math.abs(dot(cross(columns[0], columns[1]), columns[2]) - 1) > 1e-6
    || Math.abs(value[12]) > 1e-9 || Math.abs(value[13]) > 1e-9 || Math.abs(value[14]) > 1e-9 || Math.abs(value[15] - 1) > 1e-9) {
    throw new Error("Snap occurrence transform must be rigid and right-handed; scaling and reflection are unsupported.");
  }
}

function transformPoint(matrix: readonly number[], point: SnapPointMm): SnapPointMm {
  return [
    matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
    matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
    matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
  ];
}
function transformDirection(matrix: readonly number[], direction: SnapPointMm): SnapPointMm {
  return normalize([
    matrix[0] * direction[0] + matrix[1] * direction[1] + matrix[2] * direction[2],
    matrix[4] * direction[0] + matrix[5] * direction[1] + matrix[6] * direction[2],
    matrix[8] * direction[0] + matrix[9] * direction[1] + matrix[10] * direction[2],
  ]);
}

function drillSize(item: ParsedPad | ParsedVia): readonly [number, number] | null {
  const size: readonly [number, number] = "drill_size" in item && item.drill_size ? item.drill_size : [item.drill, item.drill];
  return size.length === 2 && size.every(value => Number.isFinite(value) && value > 0) ? size : null;
}
const scopedId = (occurrenceId: string, kind: string, sourceId: string) => `${occurrenceId}::${kind}::${sourceId}`;

/** Extracts only explicitly drilled pads and vias plus non-degenerate straight outline segments. */
export function extractAssemblySnapTargets(visual: VirtualBoardVisual, board: ParsedBoard): AssemblySnapTarget[] {
  assertRigidTransform(visual.transform);
  const targets: AssemblySnapTarget[] = [];
  const sourceNormal: SnapPointMm = [0, 0, 1];
  const worldNormal = transformDirection(visual.transform, sourceNormal);
  const holes: Array<{ item: ParsedPad | ParsedVia; sourceKind: "pad" | "via" }> = [
    ...board.pads.map(item => ({ item, sourceKind: "pad" as const })),
    ...board.vias.map(item => ({ item, sourceKind: "via" as const })),
  ];
  for (const { item, sourceKind } of holes) {
    const size = drillSize(item);
    if (!size || !item.id || item.at.length !== 2 || !item.at.every(Number.isFinite)) continue;
    const sourcePointMm = point3(item.at);
    targets.push({
      kind: "hole", id: scopedId(visual.id, sourceKind, item.id), occurrenceId: visual.id, sourceId: item.id, sourceKind,
      sourcePointMm, worldPointMm: transformPoint(visual.transform, sourcePointMm), sourceNormal, worldNormal,
      drillSizeMm: size, ...(sourceKind === "pad" ? { plated: (item as ParsedPad).plated } : {}),
    });
  }
  board.outlineLoops.forEach((loop, loopIndex) => {
    if (loop.length < 2) return;
    const signedArea = loop.reduce((area, current, index) => {
      const next = loop[(index + 1) % loop.length];
      return area + current[0] * next[1] - next[0] * current[1];
    }, 0);
    const closed = Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1]) <= EPSILON;
    const edgeCount = closed ? loop.length - 1 : loop.length;
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const start = loop[edgeIndex], end = loop[(edgeIndex + 1) % loop.length];
      if (!start?.every(Number.isFinite) || !end?.every(Number.isFinite)) continue;
      const delta: SnapPointMm = [end[0] - start[0], end[1] - start[1], 0];
      const lengthMm = Math.hypot(...delta);
      if (lengthMm <= EPSILON) continue;
      const sourceDirection = normalize(delta);
      const left: SnapPointMm = [-sourceDirection[1], sourceDirection[0], 0];
      const sourceOutward = signedArea >= 0 ? scale(left, -1) : left;
      const sourcePointMm: SnapPointMm = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, 0];
      const sourceId = `${loopIndex}:${edgeIndex}`;
      targets.push({
        kind: "edge", id: scopedId(visual.id, "edge", sourceId), occurrenceId: visual.id, sourceId, loopIndex, edgeIndex,
        sourcePointMm, worldPointMm: transformPoint(visual.transform, sourcePointMm), sourceDirection,
        worldDirection: transformDirection(visual.transform, sourceDirection), sourceOutward,
        worldOutward: transformDirection(visual.transform, sourceOutward), sourceNormal, worldNormal, lengthMm,
      });
    }
  });
  return targets;
}

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
const identity3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function rotationBetween(from: SnapPointMm, to: SnapPointMm): Mat3 {
  const a = normalize(from), b = normalize(to), cosine = Math.max(-1, Math.min(1, dot(a, b)));
  if (cosine > 1 - 1e-12) return identity3;
  let axis = cross(a, b);
  if (cosine < -1 + 1e-12) {
    const basis: SnapPointMm = Math.abs(a[0]) <= Math.abs(a[1]) && Math.abs(a[0]) <= Math.abs(a[2]) ? [1, 0, 0]
      : Math.abs(a[1]) <= Math.abs(a[2]) ? [0, 1, 0] : [0, 0, 1];
    axis = normalize(cross(a, basis));
  } else axis = normalize(axis);
  const sine = cosine < -1 + 1e-12 ? 0 : Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const [x, y, z] = axis, oneMinus = 1 - cosine;
  return [
    cosine + x * x * oneMinus, x * y * oneMinus - z * sine, x * z * oneMinus + y * sine,
    y * x * oneMinus + z * sine, cosine + y * y * oneMinus, y * z * oneMinus - x * sine,
    z * x * oneMinus - y * sine, z * y * oneMinus + x * sine, cosine + z * z * oneMinus,
  ];
}
function apply3(matrix: Mat3, value: SnapPointMm): SnapPointMm {
  return [matrix[0] * value[0] + matrix[1] * value[1] + matrix[2] * value[2], matrix[3] * value[0] + matrix[4] * value[1] + matrix[5] * value[2], matrix[6] * value[0] + matrix[7] * value[1] + matrix[8] * value[2]];
}
function rotateOccurrence(rotation: Mat3, transform: readonly number[]): number[] {
  const columns = [
    [transform[0], transform[4], transform[8]] as SnapPointMm,
    [transform[1], transform[5], transform[9]] as SnapPointMm,
    [transform[2], transform[6], transform[10]] as SnapPointMm,
  ].map(column => apply3(rotation, column));
  return [columns[0][0], columns[1][0], columns[2][0], 0, columns[0][1], columns[1][1], columns[2][1], 0, columns[0][2], columns[1][2], columns[2][2], 0, 0, 0, 0, 1];
}

/** Returns a fresh rigid source-to-assembly transform for the moving occurrence. */
export function snapOccurrenceTransform(
  movingTransform: readonly number[], moving: AssemblySnapTarget, fixed: AssemblySnapTarget, options: SnapPlacementOptions = {},
): number[] {
  assertRigidTransform(movingTransform);
  if (moving.occurrenceId === fixed.occurrenceId) throw new Error("Snap targets must belong to different board occurrences.");
  if (moving.kind !== fixed.kind) throw new Error("Snap targets must have the same geometry kind.");
  const gapMm = options.gapMm ?? 0;
  if (!Number.isFinite(gapMm) || gapMm < 0) throw new Error("Snap gap must be a finite non-negative millimetre value.");
  let deltaRotation = identity3;
  if (moving.kind === "edge" && fixed.kind === "edge" && (options.edgeAngle ?? "align") === "align") {
    const desired = options.edgeDirection === "parallel" ? fixed.worldDirection : scale(fixed.worldDirection, -1);
    deltaRotation = rotationBetween(transformDirection(movingTransform, moving.sourceDirection), desired);
  }
  const rotated = rotateOccurrence(deltaRotation, movingTransform);
  const gapDirection = fixed.kind === "hole" ? fixed.worldNormal : fixed.worldOutward;
  const desiredPoint = add(fixed.worldPointMm, scale(gapDirection, gapMm));
  const rotatedSourcePoint = transformPoint(rotated, moving.sourcePointMm);
  const translation = subtract(desiredPoint, rotatedSourcePoint);
  rotated[3] = translation[0]; rotated[7] = translation[1]; rotated[11] = translation[2];
  return rotated;
}
