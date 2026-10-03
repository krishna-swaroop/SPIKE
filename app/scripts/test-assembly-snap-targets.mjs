// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { importTestTypescript } from "./import-test-typescript.mjs";

const api = await importTestTypescript("assemblySnapTargets");
const close = (actual, expected, message, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
const pointClose = (actual, expected, message) => actual.forEach((value, index) => close(value, expected[index], `${message}[${index}]`));
const transformPoint = (matrix, point) => [
  matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + matrix[3],
  matrix[4] * point[0] + matrix[5] * point[1] + matrix[6] * point[2] + matrix[7],
  matrix[8] * point[0] + matrix[9] * point[1] + matrix[10] * point[2] + matrix[11],
];
const board = {
  width: 30, height: 20, bounds: { minX: 10, minY: -5, maxX: 40, maxY: 15 },
  outlineLoops: [[[10, -5], [40, -5], [40, 15], [10, 15]]], tracks: [], zones: [], components: [], drawings: [], layers: [], layerDefinitions: [], stackup: [], nets: {},
  pads: [
    { id: "npth", name: "", at: [14, 1], width: 3, height: 3, rotation: 0, shape: "circle", drill: 2, drill_size: [2, 2], type: "np_thru_hole", pad_kind: "np_thru_hole", plated: false, layers: ["*.Cu"], layer: "F.Cu" },
    { id: "smd", name: "1", at: [20, 2], width: 2, height: 1, rotation: 0, shape: "rect", drill: 0, layers: ["F.Cu"], layer: "F.Cu", net: "GND" },
  ],
  vias: [{ id: "via-1", at: [30, 4], size: 1, drill: 0.5, layers: ["F.Cu", "B.Cu"], net: "GND" }],
};
const fixedVisual = { id: "fixed", name: "Fixed", designId: "d", active: true, widthMm: 30, heightMm: 20, localCenterMm: [25, 5, 0], transform: [0, -1, 0, 100, 1, 0, 0, 20, 0, 0, 1, 7, 0, 0, 0, 1] };
const fixedTargets = api.extractAssemblySnapTargets(fixedVisual, board);
assert.equal(fixedTargets.filter(target => target.kind === "hole").length, 2, "only actual drilled pads and vias are holes");
assert.equal(fixedTargets.filter(target => target.kind === "edge").length, 4, "an open outline loop receives its closing straight edge");
const fixedHole = fixedTargets.find(target => target.sourceId === "npth");
assert.equal(fixedHole.plated, false, "NPTH provenance is retained");
assert.equal(fixedHole.id, "fixed::pad::npth", "target IDs are occurrence scoped");
pointClose(fixedHole.sourcePointMm, [14, 1, 0], "non-zero source origin retained");
pointClose(fixedHole.worldPointMm, [99, 34, 7], "source point projected by occurrence matrix");

const movingVisual = { ...fixedVisual, id: "moving", transform: [1, 0, 0, -25, 0, -1, 0, 12, 0, 0, -1, 3, 0, 0, 0, 1] };
const movingTargets = api.extractAssemblySnapTargets(movingVisual, board);
const movingHole = movingTargets.find(target => target.sourceId === "npth");
pointClose(movingHole.worldPointMm, [-11, 11, 3], "rotated flipped board projects correctly");
pointClose(movingHole.worldNormal, [0, 0, -1], "flipped board normal projects correctly");
const originalTransform = [...movingVisual.transform];
const holePlacement = api.snapOccurrenceTransform(movingVisual.transform, movingHole, fixedHole, { gapMm: 2.5 });
assert.deepEqual(movingVisual.transform, originalTransform, "snap calculation does not mutate the occurrence transform");
pointClose(transformPoint(holePlacement, movingHole.sourcePointMm), [99, 34, 9.5], "hole center aligns with explicit inter-board separation");
assert.deepEqual([holePlacement[0], holePlacement[1], holePlacement[2], holePlacement[4], holePlacement[5], holePlacement[6], holePlacement[8], holePlacement[9], holePlacement[10]], [1, 0, 0, 0, -1, 0, 0, 0, -1], "hole snapping preserves rotation without scale");
assert.throws(() => api.snapOccurrenceTransform(fixedVisual.transform, fixedHole, fixedHole), /different board occurrences/);

const fixedEdge = fixedTargets.find(target => target.kind === "edge" && target.edgeIndex === 0);
const movingEdge = movingTargets.find(target => target.kind === "edge" && target.edgeIndex === 0);
const edgePlacement = api.snapOccurrenceTransform(movingVisual.transform, movingEdge, fixedEdge, { gapMm: 1.25, edgeAngle: "align" });
const placedStart = transformPoint(edgePlacement, [10, -5, 0]);
const placedEnd = transformPoint(edgePlacement, [40, -5, 0]);
const placedDirection = [(placedEnd[0] - placedStart[0]) / 30, (placedEnd[1] - placedStart[1]) / 30, (placedEnd[2] - placedStart[2]) / 30];
pointClose(placedDirection, fixedEdge.worldDirection.map(value => -value), "edge direction aligns antiparallel by minimal rotation");
pointClose(transformPoint(edgePlacement, movingEdge.sourcePointMm), fixedEdge.worldPointMm.map((value, index) => value + fixedEdge.worldOutward[index] * 1.25), "edge midpoint retains configured clearance");
const retained = api.snapOccurrenceTransform(movingVisual.transform, movingEdge, fixedEdge, { edgeAngle: "retain" });
assert.deepEqual([retained[0], retained[1], retained[2], retained[4], retained[5], retained[6], retained[8], retained[9], retained[10]], [1, 0, 0, 0, -1, 0, 0, 0, -1], "retain mode keeps the moving edge angle");

const antiParallelVisual = { ...movingVisual, id: "anti", transform: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const antiEdge = api.extractAssemblySnapTargets(antiParallelVisual, board).find(target => target.kind === "edge" && target.edgeIndex === 0);
const antiPlacementA = api.snapOccurrenceTransform(antiParallelVisual.transform, antiEdge, fixedEdge, { edgeDirection: "parallel" });
const antiPlacementB = api.snapOccurrenceTransform(antiParallelVisual.transform, antiEdge, fixedEdge, { edgeDirection: "parallel" });
assert.deepEqual(antiPlacementA, antiPlacementB, "anti-parallel edge rotation is deterministic");
pointClose(transformPoint(antiPlacementA, [40, -5, 0]).map((value, index) => value - transformPoint(antiPlacementA, [10, -5, 0])[index]).map(value => value / 30), fixedEdge.worldDirection, "anti-parallel case reaches the requested direction");
assert.throws(() => api.snapOccurrenceTransform(movingVisual.transform, movingHole, fixedEdge), /same geometry kind/);
console.log("Assembly hole and edge snap target extraction and rigid placement passed");
