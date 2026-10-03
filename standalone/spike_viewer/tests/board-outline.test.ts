// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { openOutlineRing } from "../src/engine/boardOutline";
import { Shape, ShapeGeometry, Vector2 } from "three";
import type { Point } from "../src/engine/boardTypes";

test("open and closed board outlines retain identical area and cutouts", () => {
  const outline: Point[] = [[10,20],[110,20],[110,82],[10,82]];
  const hole: Point[] = [[93,66],[101,66],[101,73],[93,73]];
  const area = (outer: Point[], inner: Point[]) => {
    const shape = new Shape(openOutlineRing(outer).map(p => new Vector2(...p)));
    shape.holes.push(new Shape(openOutlineRing(inner).map(p => new Vector2(...p))));
    const geometry = new ShapeGeometry(shape);
    const positions = geometry.getAttribute("position"), indexes = geometry.getIndex()!;
    let total = 0;
    for (let i=0; i<indexes.count; i+=3) {
      const a=indexes.getX(i), b=indexes.getX(i+1), c=indexes.getX(i+2);
      total += Math.abs((positions.getX(b)-positions.getX(a))*(positions.getY(c)-positions.getY(a))-(positions.getY(b)-positions.getY(a))*(positions.getX(c)-positions.getX(a)))/2;
    }
    geometry.dispose(); return total;
  };
  assert.equal(area(outline, hole), 100*62-8*7);
  assert.equal(area([...outline,outline[0]], [...hole,hole[0]]), 100*62-8*7);
  assert.equal(outline.length, 4);
});
