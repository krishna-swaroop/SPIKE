// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "../src/engine/boardTypes";
import type { BoardBinding, VirtualLayer, Vec3 } from "../src/overlays/types";

export const binding: BoardBinding = { boardId: "viewer-lab-board", revision: "1" };
/** Original, redistributable geometry fixture; not a manufactured or solved design. */
export const board: ParsedBoard = {
  width: 100, height: 62, bounds: { minX: 10, maxX: 110, minY: 20, maxY: 82 },
  outlineLoops: [[[10,20],[110,20],[110,82],[10,82]], [[93,66],[101,66],[101,73],[93,73]]],
  layers: ["F.Cu", "B.Cu"],
  layerDefinitions: [{ id: 0, name: "F.Cu", kind: "signal" }, { id: 31, name: "B.Cu", kind: "signal" }, { id: 44, name: "Edge.Cuts", kind: "user" }],
  stackup: [{ name: "F.Cu", type: "copper", thickness: .035 }, { name: "core", type: "dielectric", thickness: 1.53 }, { name: "B.Cu", type: "copper", thickness: .035 }],
  nets: { "1": "VCC", "2": "GND", "3": "SIGNAL" },
  tracks: [
    { id: "track-vcc", start: [25,36], end: [55,36], width: 1.2, layer: "F.Cu", net: "VCC" },
    { id: "track-signal-1", start: [55,46], end: [77,46], width: .7, layer: "F.Cu", net: "SIGNAL" },
    { id: "track-signal-2", start: [77,46], end: [90,33], width: .7, layer: "F.Cu", net: "SIGNAL" },
    { id: "track-ground", start: [25,57], end: [82,57], width: 1.5, layer: "B.Cu", net: "GND" },
  ],
  pads: Array.from({ length: 8 }, (_, i) => ({ id: `pad-${i}`, name: String(i+1), at: [23+i*9, 57] as [number,number], width: 3, height: 4, rotation: 0, shape: "rect", drill: 1, layers: ["F.Cu","B.Cu"], layer: "F.Cu", net: i%2 ? "SIGNAL" : "GND", ref: "J1", type: "thru_hole" })),
  vias: [{ id: "via-vcc", at: [55,36], size: 2, drill: .8, layers: ["F.Cu","B.Cu"], net: "VCC" }],
  components: [
    { id: "u1", ref: "U1", value: "Controller", library: "Demo", at: [56,41], width: 14, height: 12, rotation: 0, layer: "F.Cu", modelOffset: [0,0,0], modelScale: [1,1,1], modelRotation: [0,0,0] },
    { id: "j1", ref: "J1", value: "Header", library: "Demo", at: [54,57], width: 70, height: 5, rotation: 0, layer: "F.Cu", modelOffset: [0,0,0], modelScale: [1,1,1], modelRotation: [0,0,0] },
  ],
  zones: [{ id: "ground-fill", points: [[14,24],[106,24],[106,78],[14,78]], holes: [[[91,64],[103,64],[103,75],[91,75]]], layer: "B.Cu", net: "GND" }],
  drawings: [],
};

const base = (id: string, label: string, quantity: string, unit: string): Omit<VirtualLayer,"frames"> => ({
  schema: "spike-viewer/virtual-layer/v1", id, label, binding: { ...binding }, quantity, unit,
  provenance: { source: "Original viewer demonstration", status: "synthetic", notes: "Illustrative virtual data; no solver was run." }, visible: true, opacity: .8,
});
const grid: Vec3[] = Array.from({ length: 35 }, (_, i) => [20+(i%7)*13, 29+Math.floor(i/7)*10, 1.1]);
export function demoLayers(): VirtualLayer[] {
  return [
    { ...base("temperature", "Temperature samples", "Temperature", "degC"), range: [20,85], frames: [0,1,2].map(f => ({ id: `t${f}`, label: `${f} seconds`, timeSeconds: f,
      primitives: [{ kind: "points", id: "thermal-grid", positionsMm: grid.map(p => [...p] as Vec3), values: grid.map((p, i) => i === 6 ? null : 25 + f*6 + 40*Math.exp(-((p[0]-58)**2+(p[1]-42)**2)/500)), radiusMm: 1.9 }] })) },
    { ...base("flow", "Vector field", "Velocity", "m/s"), frames: [{ id: "static", label: "Vector plane", primitives: [{ id: "velocity", kind: "vectors", positionsMm: [[27,30,7],[42,30,7],[57,30,7],[72,30,7],[87,30,7]], vectors: [[1,1,0],[1,1.2,.2],[.5,1.5,.4],[-.5,1.2,.2],[-1,1,0]], displayScaleMm: 6, color: "#73d9e9" }] }] },
    { ...base("surface", "Supplied triangle surface", "Voltage", "V"), visible: false, range: [0,5], frames: [{ id: "static", label: "Supplied mesh", primitives: [{ id: "field-mesh", kind: "surface", positionsMm: [[30,30,2],[80,30,2],[80,65,2],[30,65,2],[55,47,5]], triangles: [[0,1,4],[1,2,4],[2,3,4],[3,0,4]], values: [0,1.5,3,2,5] }] }] },
    { ...base("notes", "Paths and annotations", "Annotation", ""), frames: [{ id: "static", label: "Design notes", primitives: [
      { id: "route", kind: "path", positionsMm: [[17,73,1.2],[37,73,1.2],[45,65,1.2],[68,65,1.2]], widthMm: .8, color: "#ffd284" },
      { id: "note", kind: "labels", positionsMm: [[18,77,3],[69,65,3]], labels: ["Virtual route", "Review point"], color: "#ffd284" },
    ] }] },
  ];
}
