// SPDX-License-Identifier: Apache-2.0
import type { Point } from "./boardTypes";

/** Three.js closes paths itself; keep every distinct vertex of an open ring. */
export function openOutlineRing(points: readonly Point[]): Point[] {
  if (points.length < 2) return [...points];
  const first = points[0], last = points[points.length-1];
  return first[0] === last[0] && first[1] === last[1] ? points.slice(0,-1) : [...points];
}
