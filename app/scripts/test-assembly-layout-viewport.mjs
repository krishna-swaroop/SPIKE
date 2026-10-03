// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { importTestTypescript } from "./import-test-typescript.mjs";

const api = await importTestTypescript("assemblyLayout2d");
const interaction = await importTestTypescript("assemblyViewportInteraction");
const transform = [0, -1, 0, 100, 1, 0, 0, 20, 0, 0, 1, 7, 0, 0, 0, 1];
assert.deepEqual(api.projectAssemblyPoint(transform, [2, 3, 0]), [97, 22, 7]);
assert.equal(api.assemblySvgMatrix(transform), "matrix(0 1 -1 0 100 20)");
const visual = { id: "upper", name: "Upper", designId: "cpu", active: true, widthMm: 20, heightMm: 10, localCenterMm: [5, 10, 0], transform };
const board = { bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 }, width: 20, height: 10, nets: { "12": "VCC", "19": "GND" } };
assert.deepEqual(api.assemblyBoardBounds(visual, board), { x: 90, y: 20, width: 10, height: 20 });
assert.equal(api.boardAssemblyZ(visual), 7, "stacked boards retain explicit assembly Z for ordering and selector labels");
const secondOccurrence = { ...visual, id: "upper-copy", transform: [1, 0, 0, -30, 0, 1, 0, 4, 0, 0, 1, 1, 0, 0, 0, 1] };
const harness = { id: "h1", routeMm: [], endpointA: { positionMm: [70, 10, 0] }, endpointB: { positionMm: [110, 50, 0] } };
assert.deepEqual(api.harnessAssemblyPoints(harness), [[70, 10, 0], [110, 50, 0]], "unrouted harnesses retain both exact endpoints");
const bounds = api.assemblyContentBounds([visual, secondOccurrence], { cpu: board }, [harness]);
assert.ok(bounds.x < 70 && bounds.y < 10 && bounds.x + bounds.width > 110 && bounds.y + bounds.height > 50, "fit includes complete boards and harness routes");
assert.equal(api.canonicalNetId(board, { VCC: "net-uuid-vcc" }, "VCC"), "net-uuid-vcc", "retained canonical net IDs take priority over parser IDs");
assert.equal(api.canonicalNetId(board, undefined, "GND"), "19", "legacy parser IDs remain a bounded fallback");
assert.equal(api.canonicalNetId(board, undefined, "LOCAL"), "LOCAL", "unmapped local names remain selectable");
assert.notDeepEqual(api.assemblyBoardBounds(visual, board), api.assemblyBoardBounds(secondOccurrence, board), "repeated designs keep occurrence transforms independent");
const physicalBefore = structuredClone([visual.transform, secondOccurrence.transform]);
const plotted = { ...board, bounds: {minX:114,minY:78,maxX:134,maxY:88},
  layoutViewBox:[0,0,24,14], layoutLayerUrls:{"F.Cu":"blob:layer"} };
assert.deepEqual(api.assemblyLayoutImageBounds(plotted), {x:112,y:76,width:24,height:14},
  "plot page origin must be mapped back to source board coordinates");
const plottedPlacements = api.arrangeAssemblyBoards([visual, secondOccurrence], {cpu:plotted});
assert.deepEqual(plottedPlacements.map(item => [item.bounds.width,item.bounds.height]), [[14,24],[24,14]],
  "fit and packing include the full plot page under occurrence rotation");
const overlapping = { ...secondOccurrence, id: "overlap", transform: [...visual.transform] };
const rotated = { ...visual, id: "rotated", transform: [Math.SQRT1_2, -Math.SQRT1_2, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 0, 1, 3, 0, 0, 0, 1] };
const placements = api.arrangeAssemblyBoards([visual, secondOccurrence, overlapping, rotated], { cpu: board });
assert.equal(placements.length, 4, "every board occurrence receives a display placement");
for (let i = 0; i < placements.length; i += 1) for (let j = i + 1; j < placements.length; j += 1) {
  const a = placements[i].bounds, b = placements[j].bounds;
  assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `display AABBs ${placements[i].visual.id}/${placements[j].visual.id} do not overlap`);
}
assert.deepEqual([visual.transform, secondOccurrence.transform], physicalBefore, "display packing leaves physical occurrence transforms unchanged");
const rotatedBounds = api.assemblyBoardBounds(rotated, board);
assert.ok(rotatedBounds.width > 20 && rotatedBounds.height > 20, "rotated bounds conservatively include all transformed corners");
const offsets = api.displayOffsetByBoard(placements);
const linkedHarness = { id: "linked", routeMm: [[97, 22, 7], [40, 12, 3], [-25, 9, 1]], endpointA: { boardId: "upper", positionMm: [97, 22, 7] }, endpointB: { boardId: "upper-copy", positionMm: [-25, 9, 1] } };
const displayedRoute = api.harnessDisplayPoints(linkedHarness, offsets);
assert.deepEqual(displayedRoute[0].slice(0, 2), [97 + offsets.upper[0], 22 + offsets.upper[1]], "displayed link starts at relocated connector endpoint");
assert.deepEqual(displayedRoute.at(-1).slice(0, 2), [-25 + offsets["upper-copy"][0], 9 + offsets["upper-copy"][1]], "displayed link ends at relocated connector endpoint");

const squareViewport = { left: 10, top: 20, width: 400, height: 400 };
const wideView = { x: 0, y: 0, width: 200, height: 100 };
assert.deepEqual(interaction.assemblyClientPoint(wideView, squareViewport, 210, 220), [100, 50], "client mapping removes SVG's vertical letterbox inset");
const wheelClient = [310, 270];
const wheelAnchor = interaction.assemblyClientPoint(wideView, squareViewport, ...wheelClient);
const zoomed = interaction.zoomAssemblyViewBox(wideView, squareViewport, ...wheelClient, .82);
const anchoredAfterZoom = interaction.assemblyClientPoint(zoomed, squareViewport, ...wheelClient);
assert.ok(Math.hypot(anchoredAfterZoom[0] - wheelAnchor[0], anchoredAfterZoom[1] - wheelAnchor[1]) < 1e-9, "wheel zoom preserves the pointed assembly coordinate through letterboxing");
assert.deepEqual(interaction.panAssemblyViewBox(wideView, squareViewport, 40, -20), { x: -20, y: 10, width: 200, height: 100 }, "drag pan uses the SVG uniform meet scale on both axes");
assert.equal(interaction.assemblyPanStarted(3, 0), false, "small pointer motion remains a click for board/component/net picking");
assert.equal(interaction.assemblyPanStarted(4, 0), true, "intentional drag crosses the pan threshold");
const focused = interaction.focusAssemblyViewBox({ x: 50, y: 20, width: 30, height: 10 }, 2);
assert.ok(Math.abs(focused.width / focused.height - 2) < 1e-12 && focused.x < 50 && focused.x + focused.width > 80, "Focus frames the selected bounds at viewport aspect with margin");

const fixturePath = fileURLToPath(new URL("../../build/multiboard-workspace-20261003/arduino-r4-relay-demo.spike", import.meta.url));
if (existsSync(fixturePath)) {
  const python = process.platform === "win32" ? "python" : "python3";
  const fixtureRows = JSON.parse(execFileSync(python, ["-c", `import json,sys,zipfile
z=zipfile.ZipFile(sys.argv[1])
a=json.loads(z.read('design/assembly-ir.json'))
d=json.loads(z.read('design/assembly-designs.json'))
print(json.dumps({'boards':a['boards'],'designs':[{'design_id':x['design_id'],'bounds':x['metadata']['board_bounds_mm']} for x in d['designs']]}))`, fixturePath], { encoding: "utf8" }));
  const fixtureDesigns = Object.fromEntries(fixtureRows.designs.map(row => [row.design_id, { bounds: { minX: row.bounds[0], minY: row.bounds[1], maxX: row.bounds[2], maxY: row.bounds[3] }, width: row.bounds[2] - row.bounds[0], height: row.bounds[3] - row.bounds[1] }]));
  const fixtureVisuals = fixtureRows.boards.map(row => { const bounds = fixtureDesigns[row.design_id].bounds; return { id: row.id, name: row.name, designId: row.design_id, active: true, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY, localCenterMm: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0], transform: row.frame.transform }; });
  const realPlacements = api.arrangeAssemblyBoards(fixtureVisuals, fixtureDesigns);
  const realFit = api.displayContentBounds(realPlacements);
  assert.deepEqual(realPlacements.map(row => row.visual.id).sort(), ["relay-shield", "uno-r4-minima"], "real retained fixture contributes both occurrence-scoped boards");
  const realZoom = interaction.zoomAssemblyViewBox(realFit, { left: 0, top: 0, width: 997, height: 563 }, 640, 281, .82);
  const realPan = interaction.panAssemblyViewBox(realZoom, { left: 0, top: 0, width: 997, height: 563 }, 73, -41);
  assert.ok(realPan.width < realFit.width && realPan.x !== realFit.x && realPan.y !== realFit.y, "real two-board fit supports combined anchored zoom and pan gestures");
}
const viewportSource = await readFile(new URL("../src/AssemblyLayoutViewport.tsx", import.meta.url), "utf8");
assert.match(viewportSource, /onComponentSelect\?: \(boardId: string, componentId: string\)/, "component selection is an optional viewport API");
assert.match(viewportSource, /event\.stopPropagation\(\);\s*onFocus\(visual\.id, event\.currentTarget\);\s*onBoardSelect\(visual\);\s*onComponentSelect\?\.\(visual\.id, item\.id\)/, "component hits retain focus, select their occurrence, and cannot fall through to a net target");
assert.match(viewportSource, /<ComponentShapes[^>]+sourceLayers=\{layers\.length > 0\}/, "component hit geometry covers retained source SVG boards as well as fallback rendering");
assert.match(viewportSource, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/, "wheel cancellation is installed on a native non-passive listener");
assert.match(viewportSource, /selectionFilter !== "net"/, "Net selection mode removes component hitboxes that would occlude pads and tracks");
console.log("Assembly 2D transforms, real-fixture gestures, picking, net mapping and Fit/Focus passed");
