// SPDX-License-Identifier: Apache-2.0
import {
  placementFromTransform,
  resolveFrameToAssembly,
  transformFromPlacement,
  type AssemblyFrame,
  type AssemblyIr,
  type AssemblyPlacement,
} from "./mcadAssembly";

export type PlacementAxis = keyof AssemblyPlacement;

const EPSILON = 1e-6;

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Rejects transforms that would make a numeric placement edit discard scale,
 * shear, reflection, or a non-affine homogeneous row. */
export function isRigidTransform(transform: unknown): transform is number[] {
  if (!Array.isArray(transform) || transform.length !== 16 || !transform.every(value => typeof value === "number" && Number.isFinite(value))) return false;
  if (Math.abs(transform[12]) > EPSILON || Math.abs(transform[13]) > EPSILON
    || Math.abs(transform[14]) > EPSILON || Math.abs(transform[15] - 1) > EPSILON) return false;
  const rows = [transform.slice(0, 3), transform.slice(4, 7), transform.slice(8, 11)];
  if (rows.some(row => Math.abs(dot(row, row) - 1) > EPSILON)) return false;
  if (Math.abs(dot(rows[0], rows[1])) > EPSILON || Math.abs(dot(rows[0], rows[2])) > EPSILON
    || Math.abs(dot(rows[1], rows[2])) > EPSILON) return false;
  const determinant = rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1])
    - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0])
    + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]);
  return Math.abs(determinant - 1) <= EPSILON;
}

export function boardWorldTransform(assembly: AssemblyIr, boardId: string): number[] {
  const board = assembly.boards.find(candidate => candidate.id === boardId);
  const frame = board?.frame as AssemblyFrame | undefined;
  if (!frame) throw new Error(`Board occurrence ${boardId} has no placement frame.`);
  const world = resolveFrameToAssembly(assembly, frame);
  if (!world) throw new Error(`Board occurrence ${boardId} has an unresolved placement frame.`);
  if (!isRigidTransform(world)) throw new Error(`Board occurrence ${boardId} placement is not a rigid right-handed transform.`);
  return world;
}

export function boardWorldPlacement(assembly: AssemblyIr, boardId: string): AssemblyPlacement {
  return placementFromTransform(boardWorldTransform(assembly, boardId));
}

/** Applies absolute assembly-space position and intrinsic XYZ angle fields.
 * Unchanged fields come from the occurrence's current resolved world transform. */
export function editBoardWorldPlacement(
  assembly: AssemblyIr,
  boardId: string,
  patch: Partial<AssemblyPlacement>,
): number[] {
  const current = boardWorldPlacement(assembly, boardId);
  const next = { ...current, ...patch };
  if (!Object.values(next).every(Number.isFinite)) throw new Error("Board placement values must be finite numbers.");
  return transformFromPlacement(next);
}

